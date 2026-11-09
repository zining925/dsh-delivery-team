/**
 * vibe-delivery-team —— Client half。
 *
 * 1) 交付模式由 `/delivery` 命令在 Host 侧开启；输入框工具行
 *    `conversation.input.left` 显示「交付模式」状态胶囊（参考计划模式），
 *    胶囊内含「团队状态」入口与退出按钮。
 * 2) `shell.overlay`：右侧抽屉式「交付团队状态」面板。
 *    - 五阶段进度条、7 角色状态矩阵、当前阶段详情；
 *    - 角色行点击 = /vibe-role；产出物点击 = 官方文件打开接口；
 *    - 查看评审清单 = 触发模型输出；重置进度 = 二次确认后 /vibe-reset。
 *
 * 面板展开/宽度只保存在浏览器会话存储中（按 sessionId 隔离），不写入本地文件。
 * 面板数据来自 Host 的 /state 接口（阶段锚点 + 角色状态 + 产出物存在性）。
 */
window.__ModuleLoader__.load({
  id: 'vibe-delivery-team',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'vibe-delivery-team';
    const API = '/vibe-delivery-team';
    const REQUEST_TIMEOUT_MS = 8000;

    const DICT = {
      zh: {
        label: '软件交付模式',
        on: '开启',
        off: '关闭',
        syncing: '同步中…',
        turnOn: '开启软件交付模式',
        turnOff: '关闭软件交付模式',
        error: '开关同步失败：',
        teamStatus: '团队状态',
        modeActive: '交付模式',
        exitMode: '退出交付模式',
        panelTitle: '交付团队状态',
        close: '关闭',
        progress: '项目总进度',
        roles: '角色状态',
        details: '当前阶段详情',
        owner: '负责人',
        participants: '参与角色',
        deliverables: '交付物清单',
        pending: '待确认问题',
        review: '查看评审清单',
        reset: '重置进度',
        resetConfirm: '确认重置？',
        resetDone: '已重置到阶段01',
        reviewSent: '已请求输出评审清单',
        loading: '加载中…',
        currentStage: '当前阶段',
        percent: '完成度',
        statusIdle: '未开始',
        statusActive: '进行中',
        statusReview: '待评审',
        statusDone: '已完成',
        project: '项目',
        notDetected: '未检测到项目',
        openFailed: '打开文件失败：',
        refresh: '刷新',
        noAnswer: '暂无数据',
      },
      en: {
        label: 'Software Delivery Mode',
        on: 'On',
        off: 'Off',
        syncing: 'Syncing…',
        turnOn: 'Enable Software Delivery Mode',
        turnOff: 'Disable Software Delivery Mode',
        error: 'Switch sync failed: ',
        teamStatus: 'Team status',
        modeActive: 'Delivery mode',
        exitMode: 'Exit delivery mode',
        panelTitle: 'Delivery Team Status',
        close: 'Close',
        progress: 'Overall progress',
        roles: 'Role status',
        details: 'Current stage',
        owner: 'Owner',
        participants: 'Participants',
        deliverables: 'Deliverables',
        pending: 'Pending questions',
        review: 'View review checklist',
        reset: 'Reset progress',
        resetConfirm: 'Confirm reset?',
        resetDone: 'Reset to Stage 01',
        reviewSent: 'Review checklist requested',
        loading: 'Loading…',
        currentStage: 'Current stage',
        percent: 'Complete',
        statusIdle: 'Not started',
        statusActive: 'In progress',
        statusReview: 'In review',
        statusDone: 'Done',
        project: 'Project',
        notDetected: 'No project detected',
        openFailed: 'Failed to open file: ',
        refresh: 'Refresh',
        noAnswer: 'No data',
      },
    };

    // ------------------------------------------------------------ 接口

    /** 同源接口地址（保留 pathname 与 query）。 */
    function apiUrl(path) {
      const relative = String(path).replace(/^\/+/, '');
      if (typeof document === 'undefined') return `/${relative}`;
      const url = new URL(relative, document.baseURI);
      return `${url.pathname}${url.search}`;
    }

    /** 带超时、防跨站头的同源请求。 */
    async function callApi(path, init) {
      const options = init || {};
      const headers = { 'x-vibe-delivery-team': '1' };
      if (options.body !== undefined) headers['content-type'] = 'application/json';
      const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
      const timer = controller === undefined ? undefined : setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response;
      try {
        response = await fetch(apiUrl(`${API}${path}`), {
          cache: 'no-store',
          method: options.method || 'GET',
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller === undefined ? undefined : controller.signal,
        });
      } catch (cause) {
        const reason = cause && cause.name === 'AbortError' ? 'request timed out' : String((cause && cause.message) || cause);
        throw new Error(reason);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok || body.ok === false) throw new Error(body.error || `HTTP ${response.status}`);
      return body;
    }

    // ------------------------------------------------------------ 面板 UI 状态（跨槽共享）

    const panelState = { open: false, width: 0.5, sessionId: '', enabled: false };
    const panelListeners = new Set();

    function setPanel(patch) {
      Object.assign(panelState, patch);
      for (const listener of panelListeners) listener();
    }

    function usePanelState() {
      const [, force] = React.useReducer((value) => value + 1, 0);
      React.useEffect(() => {
        panelListeners.add(force);
        return () => panelListeners.delete(force);
      }, [force]);
      return panelState;
    }

    function storageKey(sessionId) {
      return `${NS}.panel.${sessionId}`;
    }

    function readPanelPrefs(sessionId) {
      try {
        const raw = window.localStorage.getItem(storageKey(sessionId));
        if (raw === null) return { open: false, width: 0.5 };
        const parsed = JSON.parse(raw);
        return {
          open: parsed.open === true,
          width: typeof parsed.width === 'number' && Number.isFinite(parsed.width) ? parsed.width : 0.5,
        };
      } catch {
        return { open: false, width: 0.5 };
      }
    }

    function writePanelPrefs(sessionId, patch) {
      if (!sessionId) return;
      try {
        const current = readPanelPrefs(sessionId);
        window.localStorage.setItem(storageKey(sessionId), JSON.stringify({ ...current, ...patch }));
      } catch {
        // 浏览器禁用存储时仅影响记忆，不影响面板使用。
      }
    }

    function togglePanel() {
      if (!panelState.sessionId) return;
      const next = !panelState.open;
      setPanel({ open: next });
      writePanelPrefs(panelState.sessionId, { open: next });
    }

    // ------------------------------------------------------------ 样式

    const CSS = `
.vdt-mode-status{display:inline-flex;align-items:center;gap:6px;height:26px;max-width:100%;padding:0;border:none;background:transparent!important;font:inherit;font-size:12px;line-height:18px;white-space:nowrap}
.vdt-mode-chip{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;height:26px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-brand-primary);background:transparent!important;color:var(--dsw-alias-label-primary)}
.vdt-mode-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary)}
.vdt-mode-label{flex:none;font-weight:500}
.vdt-mode-team{display:inline-flex;align-items:center;box-sizing:border-box;height:26px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent!important;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.vdt-mode-team:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}
.vdt-mode-team[aria-expanded="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.vdt-mode-exit{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:26px;height:26px;padding:0;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent!important;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;line-height:1;cursor:pointer;transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.vdt-mode-exit:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}
.vdt-mode-exit:disabled{opacity:.5;cursor:default}
.vdt-panel-root{position:fixed;inset:0;z-index:1200;pointer-events:none;font-family:inherit}
.vdt-drawer{position:absolute;top:0;right:0;bottom:0;display:flex;flex-direction:column;min-width:340px;max-width:90vw;background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l1);box-shadow:-18px 0 48px rgba(0,0,0,.18);pointer-events:auto;color:var(--dsw-alias-label-primary)}
.vdt-resize{position:absolute;left:-3px;top:0;bottom:0;width:6px;cursor:col-resize;background:transparent}
.vdt-resize:hover{background:var(--dsw-alias-border-l1)}
.vdt-panel-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none}
.vdt-panel-title{font-size:14px;font-weight:600}
.vdt-panel-sub{margin-left:auto;min-width:0;max-width:48%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-secondary)}
.vdt-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer}
.vdt-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.vdt-panel-body{flex:1;overflow:auto;padding:14px 16px 20px;display:flex;flex-direction:column;gap:14px}
.vdt-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base);padding:12px 14px}
.vdt-card-title{margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:.3px;color:var(--dsw-alias-label-secondary)}
.vdt-progress{display:flex;gap:6px;margin:2px 0 10px}
.vdt-stage{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.vdt-stage-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2)}
.vdt-stage[data-state="done"] .vdt-stage-bar{background:var(--dsw-alias-state-success-primary)}
.vdt-stage[data-state="current"] .vdt-stage-bar{background:var(--dsw-alias-brand-primary)}
.vdt-stage[data-state="pending"] .vdt-stage-bar{background:var(--dsw-alias-bg-layer-2)}
.vdt-stage-name{font-size:10px;line-height:14px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vdt-stage[data-state="current"] .vdt-stage-name{color:var(--dsw-alias-brand-primary);font-weight:600}
.vdt-stage[data-state="done"] .vdt-stage-name{color:var(--dsw-alias-label-primary)}
.vdt-progress-meta{display:flex;align-items:baseline;justify-content:space-between;gap:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.vdt-progress-meta strong{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.vdt-roles{display:flex;flex-direction:column;gap:2px}
.vdt-role{display:grid;grid-template-columns:86px 62px minmax(0,1fr);gap:8px;align-items:start;padding:8px;border-radius:8px;border:1px solid transparent;background:transparent;text-align:left;font:inherit;color:inherit;cursor:pointer}
.vdt-role:hover{background:var(--dsw-alias-bg-layer-2)}
.vdt-role[data-current="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.vdt-role-name{font-size:12px;font-weight:600;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vdt-badge{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;height:20px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.vdt-badge[data-status="active"]{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}
.vdt-badge[data-status="review"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}
.vdt-badge[data-status="done"]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}
.vdt-role-main{min-width:0;display:flex;flex-direction:column;gap:3px}
.vdt-role-task{font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.vdt-outputs{display:flex;flex-wrap:wrap;gap:4px 8px}
.vdt-file{display:inline-flex;align-items:center;gap:4px;padding:0;border:none;background:transparent;font:inherit;font-size:11px;line-height:16px;color:var(--dsw-alias-brand-primary);cursor:pointer;text-align:left}
.vdt-file:hover{text-decoration:underline}
.vdt-file:disabled{color:var(--dsw-alias-label-secondary);cursor:default;text-decoration:none}
.vdt-output{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.vdt-detail-row{display:flex;gap:8px;font-size:12px;line-height:19px;margin:0 0 6px}
.vdt-detail-key{flex:none;width:72px;color:var(--dsw-alias-label-secondary)}
.vdt-detail-val{min-width:0;word-break:break-all;color:var(--dsw-alias-label-primary)}
.vdt-detail-list{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}
.vdt-detail-file{display:flex;align-items:center;gap:6px;font-size:12px;line-height:18px}
.vdt-detail-file .vdt-file{font-size:12px}
.vdt-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.vdt-action{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.vdt-action:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.vdt-action:disabled{opacity:.55;cursor:default}
.vdt-action[data-primary="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}
.vdt-action[data-danger="true"]{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.vdt-panel-note{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.vdt-panel-error{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-state-error-primary);white-space:pre-line}
.vdt-empty{padding:18px;text-align:center;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
@media(max-width:780px){.vdt-error,.vdt-panel-sub{display:none}.vdt-role{grid-template-columns:74px 56px minmax(0,1fr)}}
`;

    const PANEL_CSS = CSS;

    // ------------------------------------------------------------ 开关 Dock

    /**
     * 输入框上方的「软件交付模式」开关 + 「团队状态」入口。
     *
     * @param {{ t?: (key: string) => string, sessionId?: string }} props
     */
    /**
     * 会话交付模式状态：Host 是唯一事实来源。
     * 指令（/delivery）在 Host 侧切换后，这里轮询同步，因此命令启动后状态会自动出现。
     */
    function useMode(sessionId) {
      const [enabled, setEnabled] = React.useState(false);
      const [ready, setReady] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');

      const load = React.useCallback(async (silent) => {
        if (!sessionId) return;
        if (!silent) {
          setReady(false);
          setError('');
        }
        try {
          const body = await callApi(`/mode?sessionId=${encodeURIComponent(sessionId)}`);
          setEnabled(body.enabled === true);
          if (!silent) setError('');
        } catch (cause) {
          if (!silent) setError(String((cause && cause.message) || cause));
        } finally {
          if (!silent) setReady(true);
        }
      }, [sessionId]);

      React.useEffect(() => {
        if (!sessionId) {
          setReady(false);
          return undefined;
        }
        load(false);
        const timer = window.setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          load(true);
        }, 2500);
        return () => window.clearInterval(timer);
      }, [load, sessionId]);

      const setMode = React.useCallback(async (next) => {
        if (!sessionId || busy) return;
        setBusy(true);
        setError('');
        try {
          const body = await callApi('/mode', { method: 'POST', body: { sessionId, enabled: next } });
          setEnabled(body.enabled === true);
        } catch (cause) {
          setError(String((cause && cause.message) || cause));
        } finally {
          setBusy(false);
        }
      }, [sessionId, busy]);

      return { enabled, ready, busy, error, setMode, refresh: () => load(true) };
    }

    // 控件样式用内联样式，避免被宿主的全局 button 样式覆盖。
    const MODE_STYLES = {
      root: {
        display: 'inline-flex', alignItems: 'center', gap: 6, height: 26,
        maxWidth: '100%', padding: 0, background: 'transparent',
      },
      chip: {
        display: 'inline-flex', alignItems: 'center', gap: 6, boxSizing: 'border-box',
        height: 26, padding: '0 9px', borderRadius: 999,
        border: '1px solid var(--dsw-alias-brand-primary)',
        background: 'transparent', color: 'var(--dsw-alias-label-primary)',
        font: 'inherit', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap',
      },
      dot: {
        flex: 'none', width: 6, height: 6, borderRadius: '50%',
        background: 'var(--dsw-alias-brand-primary)',
      },
      label: { flex: 'none', fontWeight: 500, fontSize: 12, lineHeight: '18px' },
      team: {
        display: 'inline-flex', alignItems: 'center', boxSizing: 'border-box',
        height: 26, padding: '0 9px', borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit', fontSize: 12, lineHeight: '18px', whiteSpace: 'nowrap',
        cursor: 'pointer', userSelect: 'none',
      },
      exit: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        boxSizing: 'border-box', width: 26, height: 26, padding: 0, borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'transparent', color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit', fontSize: 14, lineHeight: 1, cursor: 'pointer', userSelect: 'none',
      },
    };

    /**
     * 输入框工具行中的「交付模式」状态胶囊（参考计划模式的状态呈现）。
     * 仅模式开启时渲染：状态点 + 「交付模式」+「团队状态」+ 退出按钮。
     */
    function DeliveryModeStatus(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const sessionId = props.sessionId;
      const mode = useMode(sessionId);
      const panel = usePanelState();

      // 同步面板 store；模式关闭时自动收起面板。
      React.useEffect(() => {
        if (!sessionId || !mode.ready) return;
        const prefs = readPanelPrefs(sessionId);
        const open = mode.enabled ? prefs.open : false;
        setPanel({ sessionId, enabled: mode.enabled, open, width: prefs.width });
        if (!mode.enabled) writePanelPrefs(sessionId, { open: false });
      }, [sessionId, mode.enabled, mode.ready]);

      if (!sessionId || !mode.enabled) return null;

      const onKeyActivate = (handler) => (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handler();
      };

      return h(
        'div',
        {
          className: 'vdt-mode-status',
          style: MODE_STYLES.root,
          'data-vibe-delivery-team': 'mode-status',
          'data-style': 'outline-v145',
          title: mode.error || undefined,
        },
        h(
          'span',
          { className: 'vdt-mode-chip', style: MODE_STYLES.chip },
          h('span', { className: 'vdt-mode-dot', style: MODE_STYLES.dot, 'aria-hidden': true }),
          h('span', { className: 'vdt-mode-label', style: MODE_STYLES.label }, t('modeActive')),
        ),
        h(
          'span',
          {
            role: 'button',
            tabIndex: 0,
            className: 'vdt-mode-team',
            style: MODE_STYLES.team,
            'aria-expanded': panel.open === true,
            'aria-controls': 'vibe-delivery-team-panel',
            title: t('teamStatus'),
            onClick: togglePanel,
            onKeyDown: onKeyActivate(togglePanel),
          },
          t('teamStatus'),
        ),
        h(
          'span',
          {
            role: 'button',
            tabIndex: mode.busy ? -1 : 0,
            className: 'vdt-mode-exit',
            style: mode.busy ? { ...MODE_STYLES.exit, opacity: 0.5, cursor: 'default' } : MODE_STYLES.exit,
            'aria-disabled': mode.busy ? 'true' : 'false',
            title: t('exitMode'),
            'aria-label': t('exitMode'),
            onClick: () => {
              if (!mode.busy) mode.setMode(false);
            },
            onKeyDown: onKeyActivate(() => {
              if (!mode.busy) mode.setMode(false);
            }),
          },
          '×',
        ),
      );
    }

    // ------------------------------------------------------------ 状态面板

    const STATUS_LABELS = {
      idle: 'statusIdle',
      active: 'statusActive',
      review: 'statusReview',
      done: 'statusDone',
    };

    /**
     * 右侧抽屉面板（注册在 shell.overlay）。
     *
     * @param {{ t?: (key: string) => string }} props
     */
    function TeamStatusPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key;
      const panel = usePanelState();
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [confirmReset, setConfirmReset] = React.useState(false);

      const open = panel.open === true && panel.enabled === true && panel.sessionId !== '';

      const refresh = React.useCallback(async () => {
        if (!panel.sessionId) return;
        try {
          const body = await callApi(`/state?sessionId=${encodeURIComponent(panel.sessionId)}`);
          setData(body);
          setError('');
        } catch (cause) {
          setError(String((cause && cause.message) || cause));
        }
      }, [panel.sessionId]);

      React.useEffect(() => {
        if (!open) return undefined;
        setConfirmReset(false);
        refresh();
        const timer = window.setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
          refresh();
        }, 4000);
        return () => window.clearInterval(timer);
      }, [open, refresh]);

      // 面板关闭后不渲染任何内容（也不占用页面）。
      if (!open) return null;

      const close = () => {
        setPanel({ open: false });
        writePanelPrefs(panel.sessionId, { open: false });
      };

      const startDrag = (event) => {
        if (typeof window === 'undefined') return;
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = window.innerWidth * panelState.width;
        const sessionId = panel.sessionId;
        const onMove = (moveEvent) => {
          const next = Math.min(window.innerWidth * 0.9, Math.max(340, startWidth + (startX - moveEvent.clientX)));
          setPanel({ width: next / window.innerWidth });
        };
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          writePanelPrefs(sessionId, { width: panelState.width });
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      };

      const runAction = async (path, payload, successText) => {
        setBusy(true);
        setError('');
        setNotice('');
        try {
          await callApi(path, { method: 'POST', body: payload });
          await refresh();
          if (successText) {
            setNotice(successText);
            window.setTimeout(() => setNotice(''), 3000);
          }
        } catch (cause) {
          setError(String((cause && cause.message) || cause));
        } finally {
          setBusy(false);
        }
      };

      const openFile = async (path) => {
        if (!path) return;
        setError('');
        try {
          await callApi('/open', { method: 'POST', body: { path } });
        } catch (cause) {
          setError(t('openFailed') + String((cause && cause.message) || cause));
        }
      };

      const widthPx = typeof window === 'undefined'
        ? 640
        : Math.min(window.innerWidth * 0.9, Math.max(340, window.innerWidth * panelState.width));

      const body = [];
      if (data === null) {
        body.push(h('div', { key: 'loading', className: 'vdt-empty' }, t('loading')));
      } else {
        const stage = data.stage;
        const stages = stage.stages;
        const percent = stage.percent;
        const currentRole = data.role;

        // 1. 项目总进度
        body.push(
          h(
            'section',
            { key: 'progress', className: 'vdt-card' },
            h('h3', { className: 'vdt-card-title' }, t('progress')),
            h(
              'div',
              { className: 'vdt-progress' },
              stages.map((item) => h(
                'div',
                { key: item.id, className: 'vdt-stage', 'data-state': item.status },
                h('div', { className: 'vdt-stage-bar' }),
                h('div', { className: 'vdt-stage-name', title: item.fullName }, item.status === 'done' ? `✓ ${item.name}` : item.name),
              )),
            ),
            h(
              'div',
              { className: 'vdt-progress-meta' },
              h('span', null, `${t('currentStage')}：`, h('strong', null, `阶段${String(stage.index).padStart(2, '0')} · ${stage.short}`)),
              h('span', null, `${t('percent')} ${percent}%`),
            ),
          ),
        );

        // 2. 角色状态矩阵
        body.push(
          h(
            'section',
            { key: 'roles', className: 'vdt-card' },
            h('h3', { className: 'vdt-card-title' }, t('roles')),
            h(
              'div',
              { className: 'vdt-roles' },
              data.roles.map((role) => h(
                'div',
                {
                  key: role.name,
                  role: 'button',
                  tabIndex: 0,
                  className: 'vdt-role',
                  'data-current': role.current ? 'true' : 'false',
                  'aria-busy': busy ? 'true' : 'false',
                  title: `${t('owner')}：${role.name}`,
                  onClick: () => {
                    if (!busy) runAction('/role', { sessionId: panel.sessionId, role: role.name });
                  },
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    if (!busy) runAction('/role', { sessionId: panel.sessionId, role: role.name });
                  },
                },
                h('span', { className: 'vdt-role-name' }, role.name),
                h('span', { className: 'vdt-badge', 'data-status': role.status }, t(STATUS_LABELS[role.status] ?? 'statusIdle')),
                h(
                  'span',
                  { className: 'vdt-role-main' },
                  h('span', { className: 'vdt-role-task', title: role.task }, role.task),
                  role.outputs.length > 0
                    ? h(
                        'span',
                        { className: 'vdt-outputs' },
                        role.outputs.map((output) => {
                          if (output.path !== undefined) {
                            return h(
                              'button',
                              {
                                key: output.name,
                                type: 'button',
                                className: 'vdt-file',
                                disabled: output.exists !== true,
                                title: output.exists === true ? output.path : `${output.name}（未生成）`,
                                onClick: (event) => {
                                  event.stopPropagation();
                                  openFile(output.path);
                                },
                              },
                              `${output.exists === true ? '✅' : '—'} ${output.name}`,
                            );
                          }
                          return h('span', { key: output.name, className: 'vdt-output' }, output.name);
                        }),
                      )
                    : null,
                ),
              )),
            ),
          ),
        );

        // 3. 当前阶段详情
        const detail = data.details;
        body.push(
          h(
            'section',
            { key: 'details', className: 'vdt-card' },
            h('h3', { className: 'vdt-card-title' }, t('details')),
            h('p', { className: 'vdt-detail-row' }, h('span', { className: 'vdt-detail-key' }, t('owner')), h('span', { className: 'vdt-detail-val' }, detail.owner)),
            h('p', { className: 'vdt-detail-row' }, h('span', { className: 'vdt-detail-key' }, t('participants')), h('span', { className: 'vdt-detail-val' }, detail.participants.join('、'))),
            h(
              'div',
              { className: 'vdt-detail-row' },
              h('span', { className: 'vdt-detail-key' }, t('deliverables')),
              h(
                'ul',
                { className: 'vdt-detail-list' },
                detail.deliverables.map((file) => h(
                  'li',
                  { key: file.name, className: 'vdt-detail-file' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'vdt-file',
                      disabled: file.exists !== true,
                      title: file.path,
                      onClick: () => openFile(file.path),
                    },
                    `${file.exists === true ? '✅' : '—'} ${file.name}`,
                  ),
                )),
              ),
            ),
            h('p', { className: 'vdt-detail-row' }, h('span', { className: 'vdt-detail-key' }, t('pending')), h('span', { className: 'vdt-detail-val' }, String(detail.pendingQuestions))),
            h(
              'div',
              { className: 'vdt-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'vdt-action',
                  'data-primary': 'true',
                  disabled: busy,
                  onClick: () => runAction('/review', { sessionId: panel.sessionId }, t('reviewSent')),
                },
                t('review'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'vdt-action',
                  'data-danger': confirmReset ? 'true' : 'false',
                  disabled: busy,
                  onClick: () => {
                    if (!confirmReset) {
                      setConfirmReset(true);
                      return;
                    }
                    setConfirmReset(false);
                    runAction('/reset', { sessionId: panel.sessionId }, t('resetDone'));
                  },
                },
                confirmReset ? t('resetConfirm') : t('reset'),
              ),
            ),
            notice !== '' ? h('p', { className: 'vdt-panel-note' }, notice) : null,
            error !== '' ? h('p', { className: 'vdt-panel-error' }, error) : null,
          ),
        );

        if (error === '' && data.project && !data.project.detected) {
          body.push(h('p', { key: 'project', className: 'vdt-panel-note' }, `${t('project')}：${t('notDetected')}`));
        }
      }

      return h(
        'div',
        { className: 'vdt-panel-root', 'data-vibe-delivery-team': 'panel' },
        h('style', null, PANEL_CSS),
        h(
          'aside',
          {
            id: 'vibe-delivery-team-panel',
            className: 'vdt-drawer',
            style: { width: `${widthPx}px` },
            'aria-label': t('panelTitle'),
          },
          h('div', { className: 'vdt-resize', onPointerDown: startDrag, 'aria-hidden': true }),
          h(
            'div',
            { className: 'vdt-panel-head' },
            h('span', { className: 'vdt-panel-title' }, t('panelTitle')),
            h(
              'span',
              { className: 'vdt-panel-sub', title: data && data.project ? (data.project.root || '') : '' },
              data && data.project && data.project.root ? data.project.root : '',
            ),
            h(
              'button',
              { type: 'button', className: 'vdt-close', title: t('close'), onClick: close },
              '×',
            ),
          ),
          h('div', { className: 'vdt-panel-body' }, body),
        ),
      );
    }

    // ------------------------------------------------------------ 注册

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }));
        const t = ctx.locale.bind(NS);

        // 输入框工具行左侧：交付模式状态胶囊（命令开启后出现）+「团队状态」入口。
        ctx.effect(() =>
          ctx.slots.inject('conversation.input.left', () =>
            ctx.slots.register(
              {
                name: 'conversation.input.left',
                id: NS,
                order: 10,
                locale: NS,
                inject: (sessionId) => ({ t, sessionId }),
              },
              DeliveryModeStatus,
            ),
          ),
        );

        // 右侧抽屉面板：frame-wide overlay，按 store 决定是否渲染。
        ctx.effect(() =>
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register(
              {
                name: 'shell.overlay',
                id: 'vibe-delivery-team-panel',
                order: 100,
              },
              (props) => h(TeamStatusPanel, { ...props, t }),
            ),
          ),
        );
      },
    };
  },
});

// ============================================================
// TabRescue - background.js (v1.3)
// Soporte Multi-Monitor, Multi-Ventana y Grupos de Pestañas
// ============================================================

let saveTimeout;
let isRestoring = false;

// Memoria para recordar ventanas cerradas con la "X" (tolerancia de 60s)
const GRACE_PERIOD_MS = 60 * 1000;
const lastKnownWindows = new Map(); // windowId -> windowData
let recentlyClosedWindows = [];     // Array de { closedAt: number, winData: windowData }

const VALID_COLORS = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);

// 1. GUARDADO CON SOPORTE PARA MÚLTIPLES VENTANAS, MONITORES Y GRUPOS
async function saveCurrentTabs() {
    if (isRestoring) return;

    try {
        const windows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
        const groups = await chrome.tabGroups.query({});

        const groupsMap = new Map();
        groups.forEach(g => {
            groupsMap.set(g.id, {
                title: g.title || '',
                color: (g.color && VALID_COLORS.has(g.color)) ? g.color : 'grey',
                collapsed: !!g.collapsed
            });
        });

        // Limpiar ventanas cerradas que hayan superado el período de gracia
        const now = Date.now();
        recentlyClosedWindows = recentlyClosedWindows.filter(item => (now - item.closedAt) < GRACE_PERIOD_MS);

        const activeWindows = [];
        const currentWindowIds = new Set();

        for (const win of windows) {
            currentWindowIds.add(win.id);

            const validTabs = (win.tabs || []).filter(tab => 
                tab.url && 
                !tab.url.startsWith('edge://') && 
                !tab.url.startsWith('chrome://') &&
                !tab.url.startsWith('about:')
            );

            if (validTabs.length === 0) continue;

            const tabsData = validTabs.map(tab => {
                const inGroup = tab.groupId !== -1 && tab.groupId !== undefined && tab.groupId !== null;
                const groupMeta = inGroup ? groupsMap.get(tab.groupId) : null;

                return {
                    url: tab.url,
                    pinned: !!tab.pinned,
                    groupId: inGroup ? tab.groupId : null,
                    groupInfo: inGroup ? {
                        title: groupMeta?.title || '',
                        color: groupMeta?.color || 'grey',
                        collapsed: !!groupMeta?.collapsed
                    } : null
                };
            });

            const winData = {
                state: win.state === 'minimized' ? 'normal' : win.state,
                left: win.left,
                top: win.top,
                width: win.width,
                height: win.height,
                tabs: tabsData
            };

            activeWindows.push(winData);
            lastKnownWindows.set(win.id, winData);
        }

        // Quitar de lastKnownWindows las que ya no están abiertas en este ciclo
        for (const id of lastKnownWindows.keys()) {
            if (!currentWindowIds.has(id)) {
                lastKnownWindows.delete(id);
            }
        }

        // Combinar ventanas activas + ventanas cerradas recientemente (protección de cierre una por una)
        const allWindowsToSave = [
            ...activeWindows,
            ...recentlyClosedWindows.map(item => item.winData)
        ];

        // Solo guardamos si hay al menos una ventana con pestañas válidas
        if (allWindowsToSave.length > 0) {
            await chrome.storage.local.set({ 
                savedSession: { 
                    windows: allWindowsToSave,
                    lastSavedAt: Date.now()
                } 
            });
        }
    } catch (error) {
        console.error('TabRescue: Error al guardar sesión:', error);
    }
}

// 2. DISPARADORES CON DEBOUNCE (1.5s)
function triggerSave() {
    if (isRestoring) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(saveCurrentTabs, 1500);
}

// Eventos de Pestañas
chrome.tabs.onUpdated.addListener((id, change) => {
    if (change.url || change.pinned !== undefined || change.groupId !== undefined) {
        triggerSave();
    }
});
chrome.tabs.onRemoved.addListener(triggerSave);
chrome.tabs.onMoved.addListener(triggerSave);
chrome.tabs.onAttached.addListener(triggerSave);
chrome.tabs.onDetached.addListener(triggerSave);

// Eventos de Grupos
chrome.tabGroups.onCreated.addListener(triggerSave);
chrome.tabGroups.onUpdated.addListener(triggerSave);
chrome.tabGroups.onMoved.addListener(triggerSave);
chrome.tabGroups.onRemoved.addListener(triggerSave);

// Eventos de Ventanas (Captura para tolerancia de cierre con "X")
chrome.windows.onRemoved.addListener((windowId) => {
    if (isRestoring) return;

    // Si la ventana cerrada tenía datos conocidos, la preservamos en la reserva temporal
    const closedWin = lastKnownWindows.get(windowId);
    if (closedWin && closedWin.tabs && closedWin.tabs.length > 0) {
        recentlyClosedWindows.push({
            closedAt: Date.now(),
            winData: closedWin
        });
    }
    lastKnownWindows.delete(windowId);

    triggerSave();
});

// Guardar al instalar o actualizar la extensión
chrome.runtime.onInstalled.addListener(() => {
    saveCurrentTabs();
});

// 3. RESTAURACIÓN DE SESIÓN MULTI-MONITOR, MULTI-VENTANA Y GRUPOS
async function restoreSession() {
    isRestoring = true;
    recentlyClosedWindows = [];
    lastKnownWindows.clear();

    try {
        const result = await chrome.storage.local.get(["savedSession"]);
        const session = result.savedSession;

        if (!session) {
            isRestoring = false;
            return { success: false, reason: 'no_session' };
        }

        // Compatibilidad: soportar formato nuevo { windows: [...] } o formato antiguo [...]
        let windowsToRestore = [];
        if (Array.isArray(session)) {
            windowsToRestore = [{ state: 'normal', tabs: session }];
        } else if (session.windows && Array.isArray(session.windows)) {
            windowsToRestore = session.windows;
        }

        if (windowsToRestore.length === 0) {
            isRestoring = false;
            return;
        }

        const currentWindows = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
        const initialWindow = currentWindows[0];

        for (let wIndex = 0; wIndex < windowsToRestore.length; wIndex++) {
            const winData = windowsToRestore[wIndex];
            if (!winData.tabs || winData.tabs.length === 0) continue;

            let targetWindowId;
            let firstTabId = null;

            if (wIndex === 0 && initialWindow) {
                // Usar la ventana inicial que Edge ya abrió
                targetWindowId = initialWindow.id;
                firstTabId = initialWindow.tabs?.[0]?.id || null;

                // Posicionar la ventana inicial en su monitor original
                if (typeof winData.left === 'number' && typeof winData.top === 'number') {
                    try {
                        if (winData.state === 'maximized') {
                            await chrome.windows.update(initialWindow.id, {
                                left: winData.left,
                                top: winData.top,
                                width: winData.width || 1000,
                                height: winData.height || 700,
                                state: 'normal'
                            });
                            await chrome.windows.update(initialWindow.id, { state: 'maximized' });
                        } else {
                            await chrome.windows.update(initialWindow.id, {
                                left: winData.left,
                                top: winData.top,
                                width: winData.width,
                                height: winData.height,
                                state: winData.state || 'normal'
                            });
                        }
                    } catch (posErr) {
                        console.warn('TabRescue: No se pudo reposicionar ventana inicial:', posErr);
                    }
                }
            } else {
                // Crear nueva ventana posicionada en el monitor correspondiente
                const createParams = {
                    url: winData.tabs[0].url,
                    focused: false
                };

                if (typeof winData.left === 'number' && typeof winData.top === 'number') {
                    createParams.left = winData.left;
                    createParams.top = winData.top;
                    if (winData.width) createParams.width = winData.width;
                    if (winData.height) createParams.height = winData.height;
                }

                // Para monitores secundarios: crear como 'normal' en sus coordenadas primero
                createParams.state = winData.state === 'maximized' ? 'normal' : (winData.state || 'normal');

                const newWindow = await chrome.windows.create(createParams);
                targetWindowId = newWindow.id;

                if (winData.state === 'maximized') {
                    try {
                        await chrome.windows.update(targetWindowId, { state: 'maximized' });
                    } catch (maxErr) {
                        console.warn('TabRescue: No se pudo maximizar ventana:', maxErr);
                    }
                }

                const newWinTabs = await chrome.tabs.query({ windowId: targetWindowId });
                firstTabId = newWinTabs[0]?.id || null;
            }

            const groupMapping = {}; // groupIdOriginal -> { tabIds: [], ... }

            for (let tIndex = 0; tIndex < winData.tabs.length; tIndex++) {
                const item = winData.tabs[tIndex];
                let tab;

                if (tIndex === 0 && firstTabId) {
                    try {
                        tab = await chrome.tabs.update(firstTabId, {
                            url: item.url,
                            pinned: !!item.pinned
                        });
                    } catch (e) {
                        tab = await chrome.tabs.create({
                            windowId: targetWindowId,
                            url: item.url,
                            pinned: !!item.pinned
                        });
                    }
                } else {
                    tab = await chrome.tabs.create({
                        windowId: targetWindowId,
                        url: item.url,
                        pinned: !!item.pinned
                    });
                }

                // Asociar pestaña a su grupo dentro de esta ventana
                if (item.groupId !== null && item.groupId !== undefined && item.groupInfo && tab?.id) {
                    if (!groupMapping[item.groupId]) {
                        groupMapping[item.groupId] = {
                            tabIds: [],
                            title: item.groupInfo.title || '',
                            color: item.groupInfo.color || 'grey',
                            collapsed: !!item.groupInfo.collapsed
                        };
                    }
                    groupMapping[item.groupId].tabIds.push(tab.id);
                }
            }

            // Recrear los grupos correspondientes a esta ventana
            for (const originalGroupId in groupMapping) {
                const groupData = groupMapping[originalGroupId];
                if (groupData.tabIds && groupData.tabIds.length > 0) {
                    try {
                        let newGroupId;
                        try {
                            newGroupId = await chrome.tabs.group({
                                tabIds: groupData.tabIds
                            });
                        } catch (groupError1) {
                            newGroupId = await chrome.tabs.group({
                                tabIds: groupData.tabIds,
                                createProperties: { windowId: targetWindowId }
                            });
                        }

                        const updateProps = {};
                        if (groupData.title) {
                            updateProps.title = groupData.title;
                        }
                        if (groupData.color && VALID_COLORS.has(groupData.color)) {
                            updateProps.color = groupData.color;
                        }
                        if (typeof groupData.collapsed === 'boolean') {
                            updateProps.collapsed = groupData.collapsed;
                        }

                        if (Object.keys(updateProps).length > 0) {
                            await chrome.tabGroups.update(newGroupId, updateProps);
                        }
                    } catch (groupError) {
                        console.error('TabRescue: Error al restaurar grupo:', groupError);
                    }
                }
            }
        }
        return { success: true };
    } catch (error) {
        console.error('TabRescue: Error durante la restauración:', error);
        return { success: false, error: error.message };
    } finally {
        isRestoring = false;
        saveCurrentTabs();
    }
}

// Disparar restauración al abrir el navegador
chrome.runtime.onStartup.addListener(() => {
    restoreSession();
});

// 4. MENSAJERÍA PARA LA GUI (POPUP)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'SAVE_NOW') {
        saveCurrentTabs().then(() => {
            sendResponse({ success: true, timestamp: Date.now() });
        });
        return true;
    } else if (message.action === 'RESTORE_NOW') {
        restoreSession().then((res) => {
            sendResponse(res);
        });
        return true;
    } else if (message.action === 'GET_STATUS') {
        chrome.storage.local.get(["savedSession"]).then((result) => {
            sendResponse({
                savedSession: result.savedSession || null,
                isRestoring: isRestoring
            });
        });
        return true;
    }
});
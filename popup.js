// ============================================================
// TabRescue - popup.js
// Lógica de la interfaz gráfica informativa y utilitaria
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const statWindowsCount = document.getElementById("statWindowsCount");
  const statTabsCount = document.getElementById("statTabsCount");
  const statGroupsCount = document.getElementById("statGroupsCount");
  const windowsList = document.getElementById("windowsList");
  const lastSavedBadge = document.getElementById("lastSavedBadge");
  const btnSaveNow = document.getElementById("btnSaveNow");
  const btnRestoreNow = document.getElementById("btnRestoreNow");
  const toastMessage = document.getElementById("toastMessage");

  // Función para mostrar notificaciones flotantes (toast)
  function showToast(text, type = "success") {
    toastMessage.textContent = text;
    toastMessage.className = `toast ${type}`;
    setTimeout(() => {
      toastMessage.className = "toast hidden";
    }, 2800);
  }

  // Formato amigable de tiempo transcurrido
  function formatRelativeTime(timestamp) {
    if (!timestamp) return "Guardado recientemente";
    const diffSec = Math.floor((Date.now() - timestamp) / 1000);
    if (diffSec < 5) return "Guardado hace un momento";
    if (diffSec < 60) return `Guardado hace ${diffSec}s`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `Guardado hace ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    return `Guardado hace ${diffHours} h`;
  }

  // Cargar y mostrar datos de la sesión actual
  async function loadSessionData() {
    try {
      const data = await chrome.storage.local.get(["savedSession"]);
      const session = data.savedSession;

      let windows = [];
      let lastSavedAt = null;

      if (session) {
        if (Array.isArray(session)) {
          windows = [{ state: "normal", tabs: session }];
        } else if (session.windows && Array.isArray(session.windows)) {
          windows = session.windows;
          lastSavedAt = session.lastSavedAt || null;
        }
      }

      // Si aún no hay guardado en storage, obtener estado en vivo
      if (windows.length === 0) {
        const liveWindows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
        windows = liveWindows.map(w => ({
          state: w.state,
          left: w.left,
          tabs: (w.tabs || []).filter(t => t.url && !t.url.startsWith("edge://") && !t.url.startsWith("chrome://"))
        }));
      }

      // Calcular totales
      let totalTabs = 0;
      let totalGroups = 0;
      const seenGroupKeys = new Set();

      windows.forEach((win, wIdx) => {
        const tabs = win.tabs || [];
        totalTabs += tabs.length;

        tabs.forEach(tab => {
          if (tab.groupId !== null && tab.groupId !== undefined && tab.groupInfo) {
            const key = `${wIdx}-${tab.groupId}`;
            if (!seenGroupKeys.has(key)) {
              seenGroupKeys.add(key);
              totalGroups++;
            }
          }
        });
      });

      // Actualizar contadores
      statWindowsCount.textContent = windows.length;
      statTabsCount.textContent = totalTabs;
      statGroupsCount.textContent = totalGroups;

      if (lastSavedAt) {
        lastSavedBadge.textContent = formatRelativeTime(lastSavedAt);
      } else {
        lastSavedBadge.textContent = "Sincronizado";
      }

      // Renderizar desglose de ventanas
      windowsList.innerHTML = "";

      if (windows.length === 0) {
        windowsList.innerHTML = '<div class="loading-placeholder">No hay ventanas guardadas aún.</div>';
        return;
      }

      windows.forEach((win, index) => {
        const tabs = win.tabs || [];
        const winItem = document.createElement("div");
        winItem.className = "window-item";

        // Determinar etiqueta de monitor estimado por coordenadas
        let monitorLabel = `Ventana ${index + 1}`;
        if (typeof win.left === "number") {
          monitorLabel += win.left >= 1900 ? " (Monitor Secundario)" : " (Monitor Principal)";
        }

        // Extraer grupos únicos en esta ventana
        const winGroups = new Map();
        tabs.forEach(tab => {
          if (tab.groupId !== null && tab.groupId !== undefined && tab.groupInfo) {
            if (!winGroups.has(tab.groupId)) {
              winGroups.set(tab.groupId, tab.groupInfo);
            }
          }
        });

        let groupsHtml = "";
        if (winGroups.size > 0) {
          groupsHtml = '<div class="groups-tags">';
          winGroups.forEach(g => {
            const colorClass = `dot-${g.color || "grey"}`;
            const groupTitle = g.title ? g.title : "Sin nombre";
            groupsHtml += `
              <span class="group-chip" title="Grupo: ${groupTitle}">
                <span class="group-color-dot ${colorClass}"></span>
                ${groupTitle}
              </span>`;
          });
          groupsHtml += "</div>";
        }

        winItem.innerHTML = `
          <div class="window-item-header">
            <span class="window-title">
              🖥️ ${monitorLabel}
            </span>
            <span class="window-meta">${tabs.length} pestaña${tabs.length === 1 ? "" : "s"}</span>
          </div>
          ${groupsHtml}
        `;

        windowsList.appendChild(winItem);
      });
    } catch (error) {
      console.error("TabRescue: Error al cargar datos en popup:", error);
      windowsList.innerHTML = '<div class="loading-placeholder">Error al cargar la información.</div>';
    }
  }

  // Botón "Guardar Ahora"
  btnSaveNow.addEventListener("click", async () => {
    btnSaveNow.disabled = true;
    btnSaveNow.querySelector(".btn-text").textContent = "Guardando...";

    try {
      chrome.runtime.sendMessage({ action: "SAVE_NOW" }, (response) => {
        btnSaveNow.disabled = false;
        btnSaveNow.querySelector(".btn-text").textContent = "Guardar Ahora";

        if (response && response.success) {
          showToast("¡Sesión guardada con éxito! ✓", "success");
          loadSessionData();
        } else {
          showToast("Error al guardar sesión.", "info");
        }
      });
    } catch (e) {
      btnSaveNow.disabled = false;
      btnSaveNow.querySelector(".btn-text").textContent = "Guardar Ahora";
    }
  });

  // Botón "Restaurar Sesión"
  btnRestoreNow.addEventListener("click", () => {
    const confirmRestore = confirm("¿Deseas restaurar la sesión guardada ahora mismo?");
    if (!confirmRestore) return;

    btnRestoreNow.disabled = true;
    btnRestoreNow.querySelector(".btn-text").textContent = "Restaurando...";

    chrome.runtime.sendMessage({ action: "RESTORE_NOW" }, (response) => {
      btnRestoreNow.disabled = false;
      btnRestoreNow.querySelector(".btn-text").textContent = "Restaurar Sesión";

      if (response && response.success) {
        showToast("¡Sesión restaurada correctamente!", "success");
        setTimeout(() => window.close(), 1200);
      } else {
        showToast("No hay sesión previa guardada.", "info");
      }
    });
  });

  // Carga inicial
  loadSessionData();
});

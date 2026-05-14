const state = {
  sessions: [],
  filteredSessions: [],
  selectedIds: new Set(),
  activeSessionId: "",
  loading: false,
};

const elements = {
  currentProvider: document.querySelector("#currentProvider"),
  currentModel: document.querySelector("#currentModel"),
  totalSessions: document.querySelector("#totalSessions"),
  selectedCount: document.querySelector("#selectedCount"),
  searchInput: document.querySelector("#searchInput"),
  locationFilter: document.querySelector("#locationFilter"),
  providerFilter: document.querySelector("#providerFilter"),
  sourceFilter: document.querySelector("#sourceFilter"),
  cwdFilter: document.querySelector("#cwdFilter"),
  providerSummary: document.querySelector("#providerSummary"),
  sessionsTableBody: document.querySelector("#sessionsTableBody"),
  refreshButton: document.querySelector("#refreshButton"),
  archiveSelectedButton: document.querySelector("#archiveSelectedButton"),
  restoreSelectedButton: document.querySelector("#restoreSelectedButton"),
  deleteSelectedButton: document.querySelector("#deleteSelectedButton"),
  selectAllCheckbox: document.querySelector("#selectAllCheckbox"),
  detailEmpty: document.querySelector("#detailEmpty"),
  detailContent: document.querySelector("#detailContent"),
  detailId: document.querySelector("#detailId"),
  detailProvider: document.querySelector("#detailProvider"),
  detailTimestamp: document.querySelector("#detailTimestamp"),
  detailSource: document.querySelector("#detailSource"),
  detailCwd: document.querySelector("#detailCwd"),
  detailFile: document.querySelector("#detailFile"),
  detailUserTurns: document.querySelector("#detailUserTurns"),
  detailAssistantTurns: document.querySelector("#detailAssistantTurns"),
  detailMessages: document.querySelector("#detailMessages"),
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "-";
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function providerBadge(provider) {
  return `<span class="badge">${escapeHtml(provider || "unknown")}</span>`;
}

function locationBadge(location) {
  const label = location === "archived" ? "archived" : "active";
  const className = location === "archived" ? "badge archive" : "badge active";
  return `<span class="${className}">${escapeHtml(label)}</span>`;
}

const desktopApi = {
  async invoke(command, args = {}) {
    if (window.__TAURI__?.core?.invoke) {
      return window.__TAURI__.core.invoke(command, args);
    }

    if (window.__TAURI_INTERNALS__?.invoke) {
      return window.__TAURI_INTERNALS__.invoke(command, args);
    }

    throw new Error("Tauri runtime is not available.");
  },

  async getSessions() {
    return this.invoke("get_sessions");
  },

  async archiveSessions(ids) {
    return this.invoke("archive_sessions", { ids });
  },

  async restoreSessions(ids) {
    return this.invoke("restore_sessions", { ids });
  },

  async deleteSessions(ids) {
    return this.invoke("delete_sessions", { ids });
  },
};

function gatherFilterOptions(items, key) {
  return Array.from(new Set(items.map((item) => item[key] || "unknown"))).sort();
}

function syncFilterOptions(select, values) {
  const current = select.value;
  const options = ['<option value="">全部</option>']
    .concat(values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`))
    .join("");
  select.innerHTML = options;
  select.value = values.includes(current) ? current : "";
}

function applyFilters() {
  const search = elements.searchInput.value.trim().toLowerCase();
  const location = elements.locationFilter.value;
  const provider = elements.providerFilter.value;
  const source = elements.sourceFilter.value;
  const cwdNeedle = elements.cwdFilter.value.trim().toLowerCase();

  state.filteredSessions = state.sessions.filter((session) => {
    if (location && session.location !== location) {
      return false;
    }
    if (provider && session.provider !== provider) {
      return false;
    }
    if (source && (session.source || "unknown") !== source) {
      return false;
    }
    if (cwdNeedle && !String(session.cwd || "").toLowerCase().includes(cwdNeedle)) {
      return false;
    }
    if (!search) {
      return true;
    }

    const haystack = [
      session.id,
      session.provider,
      session.providerRaw,
      session.source,
      session.cwd,
      session.firstUser,
      session.lastUser,
      session.relativePath,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
  });

  renderTable();
  syncSelectionUi();
}

function renderProviderSummary() {
  const counts = {};
  for (const session of state.sessions) {
    counts[session.provider] = (counts[session.provider] || 0) + 1;
  }

  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  elements.providerSummary.innerHTML = entries
    .map(([provider, count]) => `<button class="chip" type="button" data-provider="${escapeHtml(provider)}">${escapeHtml(provider)} <span>${count}</span></button>`)
    .join("");

  elements.providerSummary.querySelectorAll("[data-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      const nextValue = button.getAttribute("data-provider");
      elements.providerFilter.value = elements.providerFilter.value === nextValue ? "" : nextValue;
      applyFilters();
    });
  });
}

function renderTable() {
  if (state.filteredSessions.length === 0) {
    elements.sessionsTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-row">没有匹配的会话</td>
      </tr>
    `;
    return;
  }

  elements.sessionsTableBody.innerHTML = state.filteredSessions
    .map((session) => {
      const isChecked = state.selectedIds.has(session.id) ? "checked" : "";
      const isActive = session.id === state.activeSessionId ? "active-row" : "";
      return `
        <tr class="${isActive}" data-row-id="${escapeHtml(session.id)}">
          <td class="checkbox-cell">
            <input class="row-checkbox" type="checkbox" data-id="${escapeHtml(session.id)}" ${isChecked} aria-label="选择会话 ${escapeHtml(session.id)}">
          </td>
          <td>${escapeHtml(formatTimestamp(session.updatedAt))}</td>
          <td>${providerBadge(session.provider)}</td>
          <td>${locationBadge(session.location)}</td>
          <td>${escapeHtml(session.source || "-")}</td>
          <td class="mono">${escapeHtml(session.cwd || "-")}</td>
          <td>${escapeHtml(session.firstUserShort || "-")}</td>
          <td>${escapeHtml(session.lastUserShort || "-")}</td>
          <td>
            <button class="button small secondary detail-button" type="button" data-detail-id="${escapeHtml(session.id)}">详情</button>
            ${
              session.location === "active"
                ? `<button class="button small secondary archive-one-button" type="button" data-archive-id="${escapeHtml(session.id)}">归档</button>`
                : `<button class="button small secondary restore-one-button" type="button" data-restore-id="${escapeHtml(session.id)}">恢复</button>`
            }
            <button class="button small danger delete-one-button" type="button" data-delete-id="${escapeHtml(session.id)}">删除</button>
          </td>
        </tr>
      `;
    })
    .join("");

  elements.sessionsTableBody.querySelectorAll(".row-checkbox").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      const id = checkbox.getAttribute("data-id");
      if (checkbox.checked) {
        state.selectedIds.add(id);
      } else {
        state.selectedIds.delete(id);
      }
      syncSelectionUi();
    });
  });

  elements.sessionsTableBody.querySelectorAll(".detail-button").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-detail-id");
      state.activeSessionId = id;
      renderTable();
      renderDetails(id);
    });
  });

  elements.sessionsTableBody.querySelectorAll(".archive-one-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-archive-id");
      const session = state.sessions.find((item) => item.id === id);
      if (!session) {
        return;
      }
      const ok = window.confirm(`确认归档这个会话？\n\n${session.provider} | ${session.firstUserShort || session.id}`);
      if (!ok) {
        return;
      }
      await mutateSessions("archive", [id]);
    });
  });

  elements.sessionsTableBody.querySelectorAll(".restore-one-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-restore-id");
      const session = state.sessions.find((item) => item.id === id);
      if (!session) {
        return;
      }
      const ok = window.confirm(`确认恢复这个会话？\n\n${session.provider} | ${session.firstUserShort || session.id}`);
      if (!ok) {
        return;
      }
      await mutateSessions("restore", [id]);
    });
  });

  elements.sessionsTableBody.querySelectorAll(".delete-one-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-delete-id");
      const session = state.sessions.find((item) => item.id === id);
      if (!session) {
        return;
      }
      const ok = window.confirm(`确认删除这个会话？\n\n${session.provider} | ${session.firstUserShort || session.id}`);
      if (!ok) {
        return;
      }
      await mutateSessions("delete", [id]);
    });
  });
}

function renderDetails(id) {
  const session = state.sessions.find((item) => item.id === id);
  if (!session) {
    elements.detailEmpty.classList.remove("hidden");
    elements.detailContent.classList.add("hidden");
    return;
  }

  elements.detailEmpty.classList.add("hidden");
  elements.detailContent.classList.remove("hidden");
  elements.detailId.textContent = session.id;
  elements.detailProvider.textContent = session.provider;
  elements.detailTimestamp.textContent = formatTimestamp(session.timestamp);
  elements.detailSource.textContent = session.source || "-";
  elements.detailCwd.textContent = session.cwd || "-";
  elements.detailFile.textContent = session.relativePath || "-";
  elements.detailUserTurns.textContent = String(session.userTurns);
  elements.detailAssistantTurns.textContent = String(session.assistantTurns);
  elements.detailMessages.innerHTML = (session.userMessages || [])
    .map((text) => `<li>${escapeHtml(text)}</li>`)
    .join("");
}

function syncSelectionUi() {
  const visibleIds = state.filteredSessions.map((session) => session.id);
  const selectedVisibleCount = visibleIds.filter((id) => state.selectedIds.has(id)).length;
  const selectedSessions = state.sessions.filter((session) => state.selectedIds.has(session.id));
  const hasActiveSelection = selectedSessions.some((session) => session.location === "active");
  const hasArchivedSelection = selectedSessions.some((session) => session.location === "archived");
  elements.selectedCount.textContent = String(state.selectedIds.size);
  elements.archiveSelectedButton.disabled = !hasActiveSelection;
  elements.restoreSelectedButton.disabled = !hasArchivedSelection;
  elements.deleteSelectedButton.disabled = state.selectedIds.size === 0;
  elements.selectAllCheckbox.checked = visibleIds.length > 0 && selectedVisibleCount === visibleIds.length;
  elements.selectAllCheckbox.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < visibleIds.length;
}

async function fetchSessions() {
  state.loading = true;
  elements.refreshButton.disabled = true;
  try {
    const payload = await desktopApi.getSessions();
    state.sessions = payload.sessions || [];
    state.filteredSessions = state.sessions.slice();
    const providerOptions = gatherFilterOptions(state.sessions, "provider");
    const sourceOptions = gatherFilterOptions(state.sessions, "source");
    syncFilterOptions(elements.providerFilter, providerOptions);
    syncFilterOptions(elements.sourceFilter, sourceOptions);
    elements.currentProvider.textContent = payload.config?.provider || "-";
    elements.currentModel.textContent = payload.config?.model || "-";
    elements.totalSessions.textContent = String(payload.overview?.total || 0);
    renderProviderSummary();
    applyFilters();

    const stillExists = state.sessions.some((session) => session.id === state.activeSessionId);
    if (!stillExists) {
      state.activeSessionId = "";
    }
    renderDetails(state.activeSessionId);
  } catch (error) {
    window.alert(error.message);
  } finally {
    state.loading = false;
    elements.refreshButton.disabled = false;
  }
}

async function mutateSessions(action, ids) {
  let payload;
  if (action === "archive") {
    payload = await desktopApi.archiveSessions(ids);
  } else if (action === "restore") {
    payload = await desktopApi.restoreSessions(ids);
  } else if (action === "delete") {
    payload = await desktopApi.deleteSessions(ids);
  } else {
    throw new Error(`Unknown action: ${action}`);
  }

  const changedItems = payload.archived || payload.restored || payload.deleted || [];
  const changedIds = new Set(changedItems.map((item) => item.id));
  for (const id of changedIds) {
    state.selectedIds.delete(id);
    if (state.activeSessionId === id) {
      state.activeSessionId = "";
    }
  }

  await fetchSessions();
}

elements.refreshButton.addEventListener("click", fetchSessions);
elements.archiveSelectedButton.addEventListener("click", async () => {
  const ids = state.sessions
    .filter((session) => state.selectedIds.has(session.id) && session.location === "active")
    .map((session) => session.id);
  if (ids.length === 0) {
    return;
  }
  const ok = window.confirm(`确认归档选中的 ${ids.length} 个活动会话？`);
  if (!ok) {
    return;
  }
  await mutateSessions("archive", ids);
});
elements.restoreSelectedButton.addEventListener("click", async () => {
  const ids = state.sessions
    .filter((session) => state.selectedIds.has(session.id) && session.location === "archived")
    .map((session) => session.id);
  if (ids.length === 0) {
    return;
  }
  const ok = window.confirm(`确认恢复选中的 ${ids.length} 个归档会话？`);
  if (!ok) {
    return;
  }
  await mutateSessions("restore", ids);
});
elements.deleteSelectedButton.addEventListener("click", async () => {
  const ids = Array.from(state.selectedIds);
  if (ids.length === 0) {
    return;
  }
  const ok = window.confirm(`确认删除选中的 ${ids.length} 个会话？此操作不可恢复。`);
  if (!ok) {
    return;
  }
  await mutateSessions("delete", ids);
});
elements.selectAllCheckbox.addEventListener("change", () => {
  for (const session of state.filteredSessions) {
    if (elements.selectAllCheckbox.checked) {
      state.selectedIds.add(session.id);
    } else {
      state.selectedIds.delete(session.id);
    }
  }
  renderTable();
  syncSelectionUi();
});
elements.searchInput.addEventListener("input", applyFilters);
elements.locationFilter.addEventListener("change", applyFilters);
elements.providerFilter.addEventListener("change", applyFilters);
elements.sourceFilter.addEventListener("change", applyFilters);
elements.cwdFilter.addEventListener("input", applyFilters);

fetchSessions();

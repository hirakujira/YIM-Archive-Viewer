// Yahoo Messenger 對話紀錄瀏覽器 - UI 邏輯
(function () {
  'use strict';

  var state = {
    conversations: [],      // { id, account, category, peer, dates:{}, messageCount }
    filtered: [],
    activeId: null,
    activeDate: 'all',
    warnings: 0
  };

  var els = {
    input: document.getElementById('folder-input'),
    statusBar: document.getElementById('status-bar'),
    statFiles: document.getElementById('stat-files'),
    statMessages: document.getElementById('stat-messages'),
    statWarnings: document.getElementById('stat-warnings'),
    progress: document.getElementById('progress'),
    filterAccount: document.getElementById('filter-account'),
    filterCategory: document.getElementById('filter-category'),
    filterSearch: document.getElementById('filter-search'),
    convList: document.getElementById('conversation-list'),
    convHeader: document.getElementById('conversation-header'),
    convTitle: document.getElementById('conv-title'),
    convMeta: document.getElementById('conv-meta'),
    filterDate: document.getElementById('filter-date'),
    messages: document.getElementById('messages'),
    emptyState: document.getElementById('empty-state'),
    exportScope: document.getElementById('export-scope'),
    exportFormat: document.getElementById('export-format'),
    exportBtn: document.getElementById('export-btn')
  };

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatTime(ts) {
    var d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  els.input.addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    var datFiles = files.filter(function (f) {
      var path = f.webkitRelativePath || f.name;
      return /\.dat$/i.test(path) && path.indexOf('/Archive/') !== -1;
    });
    if (!datFiles.length) {
      alert('找不到 Archive 內的 .dat 紀錄，請確認選取的是 Profiles 資料夾。');
      return;
    }
    loadFiles(datFiles);
  });

  function loadFiles(datFiles) {
    els.progress.hidden = false;
    els.progress.textContent = '解析中… 0 / ' + datFiles.length;
    state.conversations = [];
    state.warnings = 0;
    var convMap = {};
    var totalMessages = 0;
    var i = 0;

    // 先收集所有帳號名，作為解密金鑰候選（封存可能被複製到別的帳號資料夾）。
    var accountSet = {};
    datFiles.forEach(function (f) {
      var m = window.YIM.parsePath(f.webkitRelativePath || f.name);
      if (m) accountSet[m.account] = true;
    });
    var candidateKeys = Object.keys(accountSet);

    function next() {
      if (i >= datFiles.length) return finish();
      var file = datFiles[i];
      var meta = window.YIM.parsePath(file.webkitRelativePath || file.name);
      if (!meta) { i++; return next(); }
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var msgs = window.YIM.parseArchive(reader.result, meta, candidateKeys);
          if (msgs.length) {
            var id = meta.account + '||' + meta.category + '||' + meta.peer;
            var conv = convMap[id];
            if (!conv) {
              conv = { id: id, account: meta.account, category: meta.category, peer: meta.peer, dates: {}, messageCount: 0 };
              convMap[id] = conv;
              state.conversations.push(conv);
            }
            conv.dates[meta.date] = (conv.dates[meta.date] || []).concat(msgs);
            conv.messageCount += msgs.length;
            totalMessages += msgs.length;
          }
        } catch (err) {
          state.warnings++;
        }
        i++;
        if (i % 25 === 0) els.progress.textContent = '解析中… ' + i + ' / ' + datFiles.length;
        next();
      };
      reader.onerror = function () { state.warnings++; i++; next(); };
      reader.readAsArrayBuffer(file);
    }

    function finish() {
      els.progress.hidden = true;
      els.statusBar.hidden = false;
      els.statFiles.textContent = datFiles.length + ' 個檔案';
      els.statMessages.textContent = totalMessages + ' 則訊息';
      els.statWarnings.textContent = state.warnings ? (state.warnings + ' 個檔案解析失敗') : '';
      // 依訊息數排序對話
      state.conversations.forEach(function (c) {
        var ds = Object.keys(c.dates).sort();
        c.firstDate = ds[0] || '';
        c.lastDate = ds[ds.length - 1] || '';
      });
      state.conversations.sort(function (a, b) { return b.messageCount - a.messageCount; });
      buildAccountFilter();
      buildCategoryFilter();
      applyFilters();
    }

    next();
  }

  function unique(arr) {
    return arr.filter(function (v, idx) { return arr.indexOf(v) === idx; });
  }

  function buildAccountFilter() {
    var accounts = unique(state.conversations.map(function (c) { return c.account; })).sort();
    els.filterAccount.innerHTML = '<option value="all">全部帳號</option>' +
      accounts.map(function (a) { return '<option value="' + escapeHtml(a) + '">' + escapeHtml(a) + '</option>'; }).join('');
  }

  function buildCategoryFilter() {
    var cats = unique(state.conversations.map(function (c) { return c.category; })).sort();
    els.filterCategory.innerHTML = '<option value="all">全部分類</option>' +
      cats.map(function (c) { return '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>'; }).join('');
  }

  function applyFilters() {
    var acc = els.filterAccount.value;
    var cat = els.filterCategory.value;
    var q = els.filterSearch.value.trim().toLowerCase();

    state.filtered = state.conversations.filter(function (c) {
      if (acc !== 'all' && c.account !== acc) return false;
      if (cat !== 'all' && c.category !== cat) return false;
      if (q) {
        if (c.peer.toLowerCase().indexOf(q) !== -1) return true;
        // 搜尋訊息內容
        return Object.keys(c.dates).some(function (d) {
          return c.dates[d].some(function (m) { return m.text.toLowerCase().indexOf(q) !== -1; });
        });
      }
      return true;
    });

    renderConversationList();
    if (state.filtered.length && !state.filtered.some(function (c) { return c.id === state.activeId; })) {
      selectConversation(state.filtered[0].id);
    } else if (!state.filtered.length) {
      state.activeId = null;
      renderMessages();
    } else {
      renderConversationList();
      renderMessages();
    }
  }

  function renderConversationList() {
    els.convList.innerHTML = state.filtered.map(function (c) {
      var active = c.id === state.activeId ? ' active' : '';
      return '<li class="' + active.trim() + '" data-id="' + escapeHtml(c.id) + '">' +
        '<div class="conv-name">' + escapeHtml(c.peer) + '</div>' +
        '<div class="conv-sub">' + escapeHtml(c.account) + ' · ' + escapeHtml(c.category) + ' · ' + c.messageCount + ' 則</div>' +
        '</li>';
    }).join('');
    Array.prototype.forEach.call(els.convList.querySelectorAll('li'), function (li) {
      li.addEventListener('click', function () { selectConversation(li.getAttribute('data-id')); });
    });
  }

  function selectConversation(id) {
    state.activeId = id;
    state.activeDate = 'all';
    var conv = findConv(id);
    if (conv) {
      var dates = Object.keys(conv.dates).sort();
      els.filterDate.innerHTML = '<option value="all">全部日期 (' + dates.length + ' 天)</option>' +
        dates.map(function (d) { return '<option value="' + d + '">' + d + '</option>'; }).join('');
    }
    renderConversationList();
    renderMessages();
  }

  function findConv(id) {
    for (var i = 0; i < state.conversations.length; i++) {
      if (state.conversations[i].id === id) return state.conversations[i];
    }
    return null;
  }

  function highlight(text, q) {
    var safe = escapeHtml(text);
    if (!q) return safe;
    var idx = text.toLowerCase().indexOf(q);
    if (idx === -1) return safe;
    // 以 escape 後重新標記，簡化處理：對整體不分段落
    var re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return safe.replace(re, '<mark>$1</mark>');
  }

  function renderMessages() {
    var conv = state.activeId ? findConv(state.activeId) : null;
    if (!conv) {
      els.convHeader.hidden = true;
      els.messages.innerHTML = '<div class="empty-state"><p>沒有符合條件的對話。</p></div>';
      return;
    }

    els.convHeader.hidden = false;
    els.convTitle.textContent = conv.peer;
    els.convMeta.textContent = conv.account + ' · ' + conv.category + ' · ' + conv.messageCount +
      ' 則訊息 · ' + conv.firstDate + ' ~ ' + conv.lastDate;

    var q = els.filterSearch.value.trim().toLowerCase();
    var dates = Object.keys(conv.dates).sort();
    if (state.activeDate !== 'all') dates = dates.filter(function (d) { return d === state.activeDate; });

    var html = '';
    dates.forEach(function (d) {
      var msgs = conv.dates[d].slice().sort(function (a, b) { return a.timestamp - b.timestamp; });
      html += '<div class="day-divider">' + (d || '未知日期') + '</div>';
      msgs.forEach(function (m) {
        var senderLine = conv.category !== 'Messages'
          ? '<div class="msg-sender">' + escapeHtml(m.sender) + '</div>' : '';
        html += '<div class="msg-row ' + m.direction + '">' +
          '<div class="bubble">' + senderLine +
          highlight(m.text, q) +
          '<div class="msg-time">' + formatTime(m.timestamp) + '</div>' +
          '</div></div>';
      });
    });

    els.messages.innerHTML = html || '<div class="empty-state"><p>此日期沒有訊息。</p></div>';
    els.messages.scrollTop = 0;
  }

  // ==== 匯出 ====

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function formatDateTime(ts) {
    var d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function sanitizeFilename(name) {
    return String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/\s+/g, '_').slice(0, 100);
  }

  function downloadBlob(filename, mime, content) {
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  // 依匯出範圍收集對話，並攤平為含日期排序的訊息清單。
  function collectExportConversations() {
    var scope = els.exportScope.value;
    var convs;
    if (scope === 'filtered') {
      convs = state.filtered.slice();
    } else {
      var active = state.activeId ? findConv(state.activeId) : null;
      convs = active ? [active] : [];
    }
    var dateFilter = (scope === 'conversation' && state.activeDate !== 'all') ? state.activeDate : null;

    return convs.map(function (c) {
      var dates = Object.keys(c.dates).sort();
      if (dateFilter) dates = dates.filter(function (d) { return d === dateFilter; });
      var messages = [];
      dates.forEach(function (d) {
        c.dates[d].slice().sort(function (a, b) { return a.timestamp - b.timestamp; }).forEach(function (m) {
          messages.push({
            date: d,
            timestamp: m.timestamp,
            datetime: formatDateTime(m.timestamp),
            time: formatTime(m.timestamp),
            sender: m.sender,
            direction: m.direction,
            text: m.text
          });
        });
      });
      return {
        account: c.account,
        category: c.category,
        peer: c.peer,
        firstDate: c.firstDate,
        lastDate: c.lastDate,
        messageCount: messages.length,
        messages: messages
      };
    }).filter(function (c) { return c.messageCount > 0; });
  }

  function buildExportPayload() {
    var scope = els.exportScope.value;
    return {
      generatedAt: new Date().toISOString(),
      scope: scope,
      filters: {
        account: els.filterAccount.value,
        category: els.filterCategory.value,
        search: els.filterSearch.value.trim(),
        date: scope === 'conversation' ? state.activeDate : 'all'
      },
      conversations: collectExportConversations()
    };
  }

  function exportJson(payload) {
    return JSON.stringify(payload, null, 2);
  }

  function escapeCsvCell(value) {
    var s = value == null ? '' : String(value);
    // 防止試算表公式注入
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv(payload) {
    var cols = ['account', 'category', 'peer', 'date', 'time', 'timestamp', 'datetime', 'sender', 'direction', 'text'];
    var rows = [cols.join(',')];
    payload.conversations.forEach(function (c) {
      c.messages.forEach(function (m) {
        rows.push([
          c.account, c.category, c.peer, m.date, m.time, m.timestamp, m.datetime, m.sender, m.direction, m.text
        ].map(escapeCsvCell).join(','));
      });
    });
    return '\ufeff' + rows.join('\r\n');
  }

  function exportHtml(payload) {
    var style = 'body{font-family:-apple-system,"Segoe UI","PingFang TC","Microsoft JhengHei",sans-serif;background:#f4f5f7;color:#1f2933;margin:0;padding:24px;}' +
      'h1{font-size:20px;}h2{font-size:16px;margin:24px 0 8px;}' +
      '.meta{font-size:12px;color:#7b8794;margin-bottom:8px;}' +
      '.day{text-align:center;font-size:12px;color:#7b8794;margin:16px 0 8px;}' +
      '.row{display:flex;margin-bottom:8px;}.row.self{justify-content:flex-end;}' +
      '.bubble{max-width:70%;padding:8px 12px;border-radius:12px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}' +
      '.self .bubble{background:#6a34c4;color:#fff;}.peer .bubble{background:#eef0f3;color:#1f2933;}' +
      '.sender{font-size:12px;color:#7b8794;margin-bottom:2px;}.time{font-size:11px;opacity:.7;margin-top:4px;text-align:right;}';

    var body = '';
    payload.conversations.forEach(function (c) {
      body += '<section><h2>' + escapeHtml(c.peer) + '</h2>' +
        '<div class="meta">' + escapeHtml(c.account) + ' · ' + escapeHtml(c.category) +
        ' · ' + c.messageCount + ' 則訊息 · ' + escapeHtml(c.firstDate) + ' ~ ' + escapeHtml(c.lastDate) + '</div>';
      var lastDate = null;
      c.messages.forEach(function (m) {
        if (m.date !== lastDate) {
          body += '<div class="day">' + escapeHtml(m.date || '未知日期') + '</div>';
          lastDate = m.date;
        }
        var senderLine = c.category !== 'Messages' ? '<div class="sender">' + escapeHtml(m.sender) + '</div>' : '';
        body += '<div class="row ' + m.direction + '"><div class="bubble">' + senderLine +
          escapeHtml(m.text) + '<div class="time">' + escapeHtml(m.time) + '</div></div></div>';
      });
      body += '</section>';
    });

    return '<!DOCTYPE html>\n<html lang="zh-Hant">\n<head>\n<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>Yahoo Messenger 對話匯出</title>\n<style>' + style + '</style>\n</head>\n<body>\n' +
      '<h1>Yahoo Messenger 對話匯出</h1>\n' +
      '<div class="meta">匯出時間：' + escapeHtml(payload.generatedAt) + '</div>\n' +
      body + '\n</body>\n</html>\n';
  }

  function exportFilenameBase(payload) {
    if (payload.scope === 'conversation' && payload.conversations.length === 1) {
      var c = payload.conversations[0];
      var datePart = payload.filters.date !== 'all' ? '_' + payload.filters.date : '';
      return sanitizeFilename('YIM_' + c.account + '_' + c.category + '_' + c.peer + datePart);
    }
    return sanitizeFilename('YIM_export_' + payload.generatedAt.slice(0, 10));
  }

  els.exportBtn.addEventListener('click', function () {
    var payload = buildExportPayload();
    if (!payload.conversations.length) {
      alert('沒有可匯出的訊息，請先選擇對話或調整篩選。');
      return;
    }
    var format = els.exportFormat.value;
    var base = exportFilenameBase(payload);
    if (format === 'json') {
      downloadBlob(base + '.json', 'application/json;charset=utf-8', exportJson(payload));
    } else if (format === 'csv') {
      downloadBlob(base + '.csv', 'text/csv;charset=utf-8', exportCsv(payload));
    } else {
      downloadBlob(base + '.html', 'text/html;charset=utf-8', exportHtml(payload));
    }
  });

  els.filterAccount.addEventListener('change', function () { state.activeId = null; applyFilters(); });
  els.filterCategory.addEventListener('change', function () { state.activeId = null; applyFilters(); });
  els.filterSearch.addEventListener('input', debounce(function () { applyFilters(); }, 200));
  els.filterDate.addEventListener('change', function () {
    state.activeDate = els.filterDate.value;
    renderMessages();
  });

  function debounce(fn, wait) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, wait);
    };
  }
})();

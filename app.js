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
    emptyState: document.getElementById('empty-state')
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

(function () {
  var GITHUB_USERNAME = 'PelmeenidHapukoorega';
  var GITHUB_REPO = 'PelmeenidHapukoorega/CI-CD-DevOps';

  // virtual filesystem 
  var FS = {
    '/': ['about.txt', 'certs.txt', 'links.txt', 'stats.txt', 'projects/', 'activity.txt'],
    '/projects/': ['ingress-page.txt', 'k3s-homelab.txt', 'logistikaou.txt']
  };
  var FILES = {
    '/about.txt': 'Self taught Engineer, Tallinn, Estonia.\nPivoting from six years in technical sales into Azure/DevOps.\nBuilding real infrastructure instead of just studying for exams.',
    '/certs.txt': 'AZ-900   Microsoft Azure Fundamentals\nAZ-104   Microsoft Azure Administrator\nSC-200   Security Operations Analyst course (BCS Koolitus)',
    '/links.txt': 'github     <a class="real-link" href="https://github.com/PelmeenidHapukoorega" target="_blank" rel="noopener">github.com/PelmeenidHapukoorega</a>\nlinkedin   <a class="real-link" href="https://www.linkedin.com/in/notherenotthere/?isSelfProfile=true" target="_blank" rel="noopener">linkedin.com/in/notherenotthere</a>',
    '/stats.txt': 'loading...', // replaced once fetchLiveStats() resolves
    '/activity.txt': 'loading...', // replaced once fetchLatestActivity() resolves
    '/projects/ingress-page.txt': 'This site. Traefik ingress, cert-manager local CA, ArgoCD GitOps,\nJenkins + Kaniko pipeline, Cloudflare tunnel around CGNAT.',
    '/projects/k3s-homelab.txt': 'Single-node K3s cluster on a headless Ubuntu laptop. Migrated\nnode_exporter, cAdvisor, Gitea, Prometheus, Grafana off Docker.',
    '/projects/logistikaou.txt': 'Scenario-based Azure migration for a fictional logistics company.\nFull Terraform: VNet, MySQL Flexible Server, Key Vault, CI/CD via\nOIDC-federated GitHub Actions, Azure Policy, monitoring alerts.'
  };

  var cwd = '/';
  var history = [];
  var histIndex = -1;
  var log = document.getElementById('log');
  var input = document.getElementById('cmd-input');
  var cwdLabel = document.getElementById('cwd-label');

  function displayPath(p) { return p === '/' ? '~' : '~' + p.slice(0, -1); }

  function print(html, cls) {
    var p = document.createElement('p');
    p.className = 'line ' + (cls || 'out');
    p.innerHTML = html;
    log.appendChild(p);
  }

  function resolve(path) {
    if (!path) return cwd;
    if (path === '..') {
      if (cwd === '/') return '/';
      var parts = cwd.split('/').filter(Boolean);
      parts.pop();
      return parts.length ? '/' + parts.join('/') + '/' : '/';
    }
    if (path === '/' || path === '~') return '/';
    if (path.startsWith('/')) return path.endsWith('/') ? path : path + '/';
    var base = cwd + path;
    return base.endsWith('/') ? base : base + '/';
  }

  function runLs(arg) {
    var dir = arg ? resolve(arg) : cwd;
    var entries = FS[dir];
    if (!entries) { print('ls: cannot access \'' + (arg || dir) + '\': not a directory', 'err'); return; }
    var html = entries.map(function (e) {
      var isDir = e.endsWith('/');
      var full = dir + e;
      var action = isDir ? "runCmd('cd " + full + "')" : "runCmd('cat " + full + "')";
      var color = isDir ? 'style="color:var(--green)"' : '';
      return '<span class="clickable" ' + color + ' role="button" tabindex="0" onclick="' + action + '">' + e + '</span>';
    }).join('  ');
    print(html);
  }

  function runCd(arg) {
    if (!arg || arg === '~' || arg === '/') { cwd = '/'; updatePrompt(); return; }
    var target = resolve(arg);
    if (!FS[target]) { print('cd: ' + arg + ': No such file or directory', 'err'); return; }
    cwd = target;
    updatePrompt();
  }

  function runCat(arg) {
    if (!arg) { print('cat: missing file operand', 'err'); return; }
    var path = arg.startsWith('/') ? arg : cwd + arg;
    var content = FILES[path];
    if (content === undefined) { print('cat: ' + arg + ': No such file or directory', 'err'); return; }
    print(content.replace(/\n/g, '<br>'));
  }

  function updatePrompt() { cwdLabel.textContent = displayPath(cwd); }

  var modal = document.getElementById('modal');
  document.getElementById('modal-close').addEventListener('click', function () { modal.hidden = true; input.focus(); });
  modal.addEventListener('click', function (e) { if (e.target === modal) { modal.hidden = true; input.focus(); } });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) { modal.hidden = true; input.focus(); } });

  var COMMANDS = {
    help: function () {
      print('available commands:\n  ls [dir]      list files\n  cd [dir]      change directory\n  cat [file]     print a file\n  pwd            print working directory\n  whoami         who am i\n  clear          clear the screen\n\n(or just click any underlined name instead of typing)\n\n# not everything is listed here.');
    },
    ls: function (arg) { runLs(arg); },
    cd: function (arg) { runCd(arg); },
    cat: function (arg) { runCat(arg); },
    pwd: function () { print(displayPath(cwd)); },
    whoami: function () { print('virtualhermit'); },
    clear: function () { log.innerHTML = ''; },
    sudo: function (arg) {
      if (arg === 'hire-me') {
        print('[sudo] password for virtualhermit: ******** <span class="out-dim">(accepted)</span>');
        modal.hidden = false;
      } else {
        print('virtualhermit is not in the sudoers file. this incident will be reported. <span class="out-dim">(kidding &mdash; try `sudo hire-me`)</span>', 'err');
      }
    }
  };

  window.runCmd = function (raw) {
    execute(raw);
    input.value = '';
    input.focus();
  };

  function execute(raw) {
    var trimmed = raw.trim();
    if (trimmed) { history.push(trimmed); }
    histIndex = history.length;
    print('<span class="prompt-user">virtualhermit</span>:<span class="prompt-path">' + displayPath(cwd) + '</span>$ <span class="cmd-echo">' + escapeHtml(trimmed) + '</span>');
    if (!trimmed) return;
    var parts = trimmed.split(/\s+/);
    var cmd = parts[0];
    var arg = parts.slice(1).join(' ');
    if (COMMANDS[cmd]) { COMMANDS[cmd](arg); }
    else { print(cmd + ': command not found (try `help`)', 'err'); }
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      execute(input.value);
      input.value = '';
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (histIndex > 0) { histIndex--; input.value = history[histIndex] || ''; }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (histIndex < history.length - 1) { histIndex++; input.value = history[histIndex] || ''; }
      else { histIndex = history.length; input.value = ''; }
    }
  });

  document.querySelector('.term').addEventListener('click', function () { input.focus(); });

  var statDot = document.getElementById('stat-dot');
  var statDeploy = document.getElementById('stat-deploy');

  function fetchLiveStats() {
    fetch('/deploy-history.json')
      .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
      .then(function (data) {
        statDeploy.textContent = data.sync_status + ' / ' + data.health_status;
        statDot.classList.remove('down');
        FILES['/stats.txt'] = 'sync         ' + data.sync_status +
          '\nhealth       ' + data.health_status +
          '\nlast_deploy  ' + data.last_deployed +
          '\ndeploy_count ' + data.deploy_count;
      })
      .catch(function () {
        statDeploy.textContent = 'not wired yet';
        statDot.classList.add('down');
        FILES['/stats.txt'] = 'deploy-history endpoint not wired up yet.\nsee: Homelabing/Ingress-page/metrics/deploy-history/';
      });
  }

  // latest activity: GitHub API fetch 
  var latestEl = document.getElementById('latest-commit');

  function fetchLatestActivity() {
    fetch('https://api.github.com/users/' + GITHUB_USERNAME + '/events/public?per_page=8')
      .then(function (res) { if (!res.ok) throw new Error(); return res.json(); })
      .then(function (events) {
        var pushEvents = events.filter(function (e) { return e.type === 'PushEvent'; }).slice(0, 6);
        if (pushEvents.length === 0) {
          latestEl.textContent = 'no recent public activity';
          FILES['/activity.txt'] = 'no recent public activity';
          return;
        }
        var first = pushEvents[0];
        var firstMsg = first.payload.commits && first.payload.commits[0] ? first.payload.commits[0].message.split('\n')[0] : 'commit';
        latestEl.textContent = firstMsg;

        var lines = pushEvents.map(function (e) {
          var repo = e.repo.name.split('/')[1] || e.repo.name;
          var commit = e.payload.commits && e.payload.commits[0];
          var msg = commit ? commit.message.split('\n')[0] : 'commit';
          return repo + '   ' + msg;
        });
        FILES['/activity.txt'] = lines.join('\n');
      })
      .catch(function () {
        latestEl.textContent = 'couldn\'t load activity';
        FILES['/activity.txt'] = 'couldn\'t reach the GitHub API just now.';
      });
  }

  // boot sequence: show identity immediately so the page isnt an empty prompt
  execute('whoami');
  print('Self taught Engineer, Tallinn, Estonia. Type <span class="clickable" role="button" tabindex="0" onclick="runCmd(\'help\')">help</span> to look around.');
  input.focus();

  fetchLiveStats();
  fetchLatestActivity();
})();
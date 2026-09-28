/* LookatStudy landing — bilingual toggle + live demo controllers.
   Demos run one authored loop each, pause when offscreen (IntersectionObserver),
   and collapse to a static mid-story frame under prefers-reduced-motion. */
(function () {
  'use strict';

  var STORAGE_KEY = 'ls-pages-lang';

  var TITLES = {
    en: 'LookatStudy — Turn almost anything into a course you actually finish',
    zh: 'LookatStudy — 把几乎任何东西，变成一门真正学得完的课'
  };

  var I18N = {
    en: {
      'a11y.skip': 'Skip to content',
      'nav.demos': 'Demos',
      'nav.shots': 'Screenshots',
      'nav.start': 'Get started',
      'hero.h1': 'Turn almost anything into a course you <em>actually finish</em>',
      'import.lede': 'A repo, an article, a video, a book — one pipeline, one gated course.',
      'map.head': 'Answer to light the next balloon',
      'map.sub': 'Exams guard each gate — master a lesson and the next one unlocks.',
      'cta.download': 'Download for desktop',
      'cta.github': 'Star on GitHub',
      'pill.local': 'Local-first',
      'pill.key': 'Bring your own key',
      'pill.account': 'No account',
      'pill.platform': 'Windows · macOS · Linux · Android',
      'rail.sign1': 'Quick Start',
      'rail.sign2': 'The Skill Map',
      'rail.l1': 'Welcome to LookatStudy',
      'rail.l2': 'Import Your First Course',
      'import.parsing': 'Parsing source',
      'import.parsed': 'Parsed \u2713',
      'fact.1': 'Complex courses become Duolingo-style micro-lessons.',
      'fact.2': 'AI tracks mastery at every node \u2014 checking in feels easy.',
      'fact.3': 'These balloons double as pinballs. Throw one!',
      'fact.4': 'Every chapter ends with a mini boss fight.',
      'rail.l3': 'Tour of the Three-Pane Layout',
      'world.hint': 'Scroll to play the demo. Drag balloons, throw the bot.',
      'tutor.head': 'A real tutor, from first question to mastery',
      'tutor.sub': 'It answers, quizzes you, proposes mastery and schedules the exam. You just keep learning.',
      'tutor.quiz.q': 'Quick check — what does an activation function do?',
      'tutor.quiz.o1': 'It compresses inputs to save memory',
      'tutor.quiz.o2': 'It adds non-linearity, so nets fit complex boundaries',
      'tutor.quiz.o3': 'It is a regularizer that prevents overfitting',
      'tutor.quiz.ok': 'Correct — mastery updated',
      'nb.head': 'Read it aloud, note it, see the map',
      'nb.sub': 'The lesson reads itself sentence by sentence; highlights become notes; the blackboard grows a concept map.',
      'nb.h3': 'The lesson pane that teaches itself',
      'nb.note': 'Note · re-read the activation formula before the quiz',
      'cm.t': 'Blackboard · concept map',
      'cm.formula': 'σ(z) = 1 / (1 + e<sup>−z</sup>)',
      'cm.n0': 'Neuron', 'cm.n1': 'Sum', 'cm.n2': 'Activate', 'cm.n3': 'Boundary',
      's4.head': 'A study buddy that is yours',
      's4.sub': 'Five preset forms, your own artwork, or classic Shimeji — same behaviors, your style.',
      's4.c1t': 'Five preset forms',
      's4.c1s': 'Ember / Frost / Moss / Astro / Ink, one tap away.',
      's4.c2t': 'Bring your own puppet',
      's4.c2s': 'Import a PNG; it is cut into a rig with all the same physics.',
      's4.c3t': 'Classic Shimeji',
      's4.c3s': 'Load Shimeji packs — they walk, climb and get thrown.',
      'import.done': 'course generated',
      'demos.title': 'Watch it carry you to the finish',
      'demos.sub': 'Not videos, but interactive recreations rebuilt in code, running right on this page.',
      'style.direct': 'Direct',
      'style.guide': 'Guide',
      'style.practice': 'Practice',
      'demo.tutor.t': 'The tutor knows your weak spot',
      'demo.tutor.s': 'Every answer updates per-concept mastery. The AI drafts, you approve.',
      'demo.chat.user': 'Start learning: Neural Network Basics',
      'demo.chat.ai': 'Good. Intuition first: a neuron takes a weighted sum of its inputs, then applies an activation. Stack layers of these and you get a network. Warm-up quiz:',
      'demo.chat.proposal': 'Proposal · Mark “Neural Network Basics” mastered + schedule a quiz',
      'demo.chat.proposalNote': 'SRS will schedule it right before you’d forget',
      'demo.chat.apply': 'Apply',
      'demo.chat.toast': 'Applied — scheduled in SRS ✓',
      'kc.nn': 'Neural nets',
      'kc.bp': 'Backprop',
      'demo.read.t': 'Read-aloud, sentence by sentence',
      'demo.read.s': 'The spoken sentence lights up as it plays. Fully offline once the voice is downloaded.',
      'demo.read.s1': 'A neuron first takes a weighted sum: z = w<sub>1</sub>x<sub>1</sub> + w<sub>2</sub>x<sub>2</sub> + b.',
      'demo.read.s2': 'Then an activation adds non-linearity: σ(z) = 1 / (1 + e<sup>−z</sup>).',
      'demo.read.s3': 'So even a single layer can learn a curved decision boundary.',
      'compLines': ['Hi! I\u2019m your study buddy.', 'My eyes follow your cursor \u2014 really.', 'You answer right, I cheer louder.', 'Click me \u2014 I hop!'],
      'demo.exam.t': 'Boss-fight exams',
      'demo.exam.s': 'Every question runs on its own countdown. Walk away and it counts; stars stay honest.',
      'demo.exam.name': 'Chapter 2 · Boss',
      'demo.exam.q': 'Which statement correctly describes a closure?',
      'demo.exam.o1': 'Local variables are destroyed once the outer function returns',
      'demo.exam.o2': 'A function bundled with the scope it was defined in',
      'demo.exam.o3': 'A loop syntax for iterating over object keys',
      'demo.exam.o4': 'A callback queued to run after an await',
      'demo.import.t': 'Almost anything becomes a course',
      'demo.import.s': 'Repos, articles, papers, videos, recordings, books: one pipeline, one course.',
      'src.github': 'GitHub repo',
      'src.folder': 'Local folder',
      'src.article': 'Web article',
      'src.arxiv': 'arXiv paper',
      'src.bili': 'Bilibili video',
      'src.podcast': 'Podcast recording',
      'src.epub': 'EPUB book',
      'demo.import.l1': 'Lesson 1 · Overview',
      'demo.import.l2': 'Lesson 2 · Core ideas',
      'demo.import.l3': 'Lesson 3 · Practice',
      'shots.title': 'The real thing',
      'shots.sub': 'Three panes, one screen: the map on the left, the tutor in the middle, your notebook on the right.',
      'shots.cap2': 'Propose → Apply: the AI drafts, you decide',
      'shots.cap3': 'Timed questions: walk away and it counts',
      'why.title': 'Why a course, not another tab',
      'why.pull': '“I star a lot of tutorials and finish almost none of them.”',
      'why.body': 'A pile of docs is missing the three things every course has.',
      'why.b1': 'A path',
      'why.b1x': ': the map decides what you study today, and locks the rest until you’ve earned it.',
      'why.b2': 'Feedback',
      'why.b2x': ': lessons break into knowledge points and your mastery is the weakest one, so nothing slips through.',
      'why.b3': 'A reason to return',
      'why.b3x': ': SM-2 brings material back right before you’d forget, and XP, streaks and crowns give tomorrow-you a reason to open it again.',
      'gs.title': 'Start finishing things',
      'gs.sub': 'A six-chapter guide course ships built in — you can click through the whole loop without an API key.',
      'gs.dl.t': 'Grab an installer',
      'gs.dl.b': 'Windows NSIS · macOS Apple-silicon dmg (unsigned: right-click → Open) · Linux AppImage + deb.',
      'gs.phone': 'Android path: a launcher APK installs Termux and runs the same app in Chrome — your data stays on the phone.',
      'gs.src.t': 'Or run from source',
      'gs.src.b': 'Any platform, Node 22 or newer:',
      'gs.copy': 'Copy',
      'gs.copied': 'Copied ✓',
      'gs.key': 'To bring the AI in: Settings → pick one of nineteen providers → paste your key → Test Connection.',
      'footer.line': 'Built for myself, shared with you. If it helps you finish something you’ve been putting off, a star would make my day.',
      'footer.releases': 'Releases'
    },
    zh: {
      'a11y.skip': '跳到正文',
      'nav.demos': '演示',
      'nav.shots': '截图',
      'nav.start': '开始使用',
      'hero.h1': '把几乎任何东西，<br>变成一门<br><em>真正学得完</em>的课',
      'import.lede': '仓库、文章、视频、电子书，一条管线，一门带关卡的课。',
      'map.head': '答对点亮下一只气球',
      'map.sub': '考试守住每一关，学会了才解锁下一课——这门课长在地图上。',
      'cta.download': '下载桌面版',
      'cta.github': 'GitHub 点星',
      'pill.local': '本地优先',
      'pill.key': '自带 Key',
      'pill.account': '无需账号',
      'pill.platform': 'Windows · macOS · Linux · Android',
      'rail.sign1': '快速上手',
      'rail.sign2': '技能地图',
      'rail.l1': '欢迎使用 LookatStudy',
      'rail.l2': '导入你的第一个课程',
      'import.parsing': '仓库解析中',
      'import.parsed': '解析完成 ✓',
      'fact.1': '复杂的课程，变成多邻国式的短课程',
      'fact.2': '每个节点 AI 记录掌握度，轻松完成打卡',
      'fact.3': '这些小球还能当弹珠玩？扔一个试试！',
      'fact.4': '每章一场小 BOSS 战，检验你的掌握度',
      'rail.l3': '三栏布局导览',
      'world.hint': '滚动推进演示;拖气球、扔 bot 随便玩。',
      'tutor.head': '一位真实的导师，<br>从第一个问题<br>到真正学会',
      'tutor.sub': '它回答、出题、提议掌握、安排考试。你只管学。',
      'tutor.quiz.q': '快问一下——激活函数的作用是什么？',
      'tutor.quiz.o1': '把输入压缩以节省内存',
      'tutor.quiz.o2': '引入非线性，让网络能拟合复杂边界',
      'tutor.quiz.o3': '一种防止过拟合的正则项',
      'tutor.quiz.ok': '答对——掌握度已更新',
      'nb.head': '朗读讲解，<br>画线成笔记，<br>黑板长出概念图',
      'nb.sub': '讲解逐句朗读;画线变笔记;黑板上的概念图随着学习生长。',
      'nb.h3': '会自己讲课的讲解区',
      'nb.note': '笔记 · 考前重读激活函数公式',
      'cm.t': '黑板 · 概念图',
      'cm.formula': 'σ(z) = 1 / (1 + e<sup>−z</sup>)',
      'cm.n0': '神经元', 'cm.n1': '加权求和', 'cm.n2': '激活', 'cm.n3': '决策边界',
      's4.head': '一只属于你的<br>伴学伙伴',
      's4.sub': '五种预设形态、导入自己的立绘、或经典 Shimeji——行为一致,风格随你。',
      's4.c1t': '五种预设形态',
      's4.c1s': 'Ember / Frost / Moss / Astro / Ink,一键切换。',
      's4.c2t': '自定义纸偶',
      's4.c2s': '导入一张立绘 PNG,自动切分并继承全部物理行为。',
      's4.c3t': '经典 Shimeji',
      's4.c3s': '加载 Shimeji 精灵包——爬墙、坠落、被扔出去都会。',
      'import.done': '课程已生成',
      'demos.title': '看它怎么带你学完',
      'demos.sub': '不是视频，是用代码在本页重建的交互演示，现在就在运行。',
      'style.direct': '精讲',
      'style.guide': '引导',
      'style.practice': '实战',
      'demo.tutor.t': 'AI 导师知道你弱在哪',
      'demo.tutor.s': '每次作答都在更新知识点掌握度；AI 起草，你批准才生效。',
      'demo.chat.user': '开始学习：神经网络基础',
      'demo.chat.ai': '好，从直觉开始：一个神经元把输入加权求和，再过激活函数。这样的层堆起来，就是神经网络。先来一道热身题：',
      'demo.chat.proposal': '提议 · 将「神经网络基础」标记为掌握 + 安排随堂考',
      'demo.chat.proposalNote': 'SRS 会在你快忘的时候安排它',
      'demo.chat.apply': '应用',
      'demo.chat.toast': '已应用，已排进复习计划 ✓',
      'kc.nn': '神经网络',
      'kc.bp': '反向传播',
      'demo.read.t': '逐句朗读',
      'demo.read.s': '正在读的句子实时高亮；语音模型下载后完全离线。',
      'demo.read.s1': '一个神经元先把输入加权求和：z = w<sub>1</sub>x<sub>1</sub> + w<sub>2</sub>x<sub>2</sub> + b。',
      'demo.read.s2': '再过激活函数引入非线性：σ(z) = 1 / (1 + e<sup>−z</sup>)。',
      'demo.read.s3': '所以哪怕只有一层，网络也能学出弯曲的决策边界。',
      'compLines': ['你好，我是你的伴学伙伴。', '我的眼睛会跟着你的鼠标走。', '答对一题，我比你还开心。', '点点我，我会跳！'],
      'demo.exam.t': 'Boss 战考试',
      'demo.exam.s': '每题独立倒计时；中途走人，未答题判错，星数保持诚实。',
      'demo.exam.name': '第 2 章 · Boss',
      'demo.exam.q': '以下哪个说法正确描述了闭包？',
      'demo.exam.o1': '外部函数返回后，其内部变量必然被销毁',
      'demo.exam.o2': '函数与其定义时所处作用域的组合',
      'demo.exam.o3': '一种遍历对象键的循环语法',
      'demo.exam.o4': '排在 await 之后执行的回调',
      'demo.import.t': '几乎什么都能变成课程',
      'demo.import.s': '仓库、网页、论文、视频、录音、电子书，都能走同一条管线，出同一门课。',
      'src.github': 'GitHub 仓库',
      'src.folder': '本地文件夹',
      'src.article': '网页文章',
      'src.arxiv': 'arXiv 论文',
      'src.bili': 'B 站视频',
      'src.podcast': '播客录音',
      'src.epub': 'EPUB 电子书',
      'demo.import.l1': '第 1 课 · 概览',
      'demo.import.l2': '第 2 课 · 核心概念',
      'demo.import.l3': '第 3 课 · 练习',
      'shots.title': '真实界面',
      'shots.sub': '三栏一屏：左边地图，中间导师，右边是你的笔记本。',
      'shots.cap2': 'Propose → Apply：AI 起草，你拍板',
      'shots.cap3': '限时作答：中途走人也照实计分',
      'why.title': '为什么是课程，而不是又一个标签页',
      'why.pull': '「我收藏了很多教程，几乎没读完过几套。」',
      'why.body': '一堆文档缺的，正是每门课都有的三样东西。',
      'why.b1': '路径',
      'why.b1x': '：今天学什么，地图说了算，其余的在你拿到皇冠前始终锁着。',
      'why.b2': '反馈',
      'why.b2x': '：课时拆成知识点，掌握度取最弱一环，糊弄不过去。',
      'why.b3': '回来的理由',
      'why.b3x': '：SM-2 在你快忘时安排复习，XP、连胜和皇冠给明天的你一个再打开的理由。',
      'gs.title': '开始把事情学完',
      'gs.sub': '内置一门六章引导课——没有 API Key 也能把整个循环点一遍。',
      'gs.dl.t': '直接下载安装包',
      'gs.dl.b': 'Windows NSIS · macOS Apple 芯片 dmg（未签名：右键 → 打开）· Linux AppImage + deb。',
      'gs.phone': 'Android 路线：启动器 APK 会装好 Termux，在 Chrome 里跑同一个应用——数据照样留在手机上。',
      'gs.src.t': '或者从源码运行',
      'gs.src.b': '任意平台，Node 22 及以上：',
      'gs.copy': '复制',
      'gs.copied': '已复制 ✓',
      'gs.key': '想接入 AI：设置 → 从十九个预设里选一家 → 粘贴 Key → Test Connection。',
      'footer.line': '为自己而做，也分享给你。如果它帮你把一直拖延的事学完了，给个 star 会让我很开心。',
      'footer.releases': '下载'
    }
  };

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- i18n ---------- */

  function apply(lang) {
    var dict = I18N[lang];
    $$('[data-i18n], [data-i18n-html]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-html') || el.getAttribute('data-i18n');
      var val = dict[key];
      if (val == null) return;
      if (el.hasAttribute('data-i18n-html')) el.innerHTML = val;
      else el.textContent = val;
    });
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = TITLES[lang];
    $$('img[data-src-en]').forEach(function (img) {
      img.src = lang === 'zh' ? img.getAttribute('data-src-zh') : img.getAttribute('data-src-en');
    });
    var label = $('#langLabel');
    if (label) label.textContent = lang === 'zh' ? 'English' : '中文';
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
  }

  function initialLang() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'zh' || saved === 'en') return saved;
    } catch (e) { /* private mode */ }
    return (navigator.language || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  }

  /* ---------- demo machinery ---------- */

  function burst(x, y, container) {
    if (REDUCED) return;
    var colors = ['#58cc02', '#ffc800', '#1cb0f6', '#ff7a1a'];
    for (var i = 0; i < 10; i++) {
      var dot = document.createElement('span');
      dot.className = 'burst';
      dot.style.left = x + 'px';
      dot.style.top = y + 'px';
      dot.style.background = colors[i % colors.length];
      container.appendChild(dot);
      var ang = (Math.PI * 2 * i) / 10 + Math.random() * 0.5;
      var dist = 34 + Math.random() * 26;
      dot.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: 'translate(' + Math.cos(ang) * dist + 'px,' + (Math.sin(ang) * dist + 14) + 'px) scale(0.4)', opacity: 0 }
      ], { duration: 750, easing: 'cubic-bezier(0.16,1,0.3,1)' }).onfinish = (function (d) { return function () { d.remove(); }; })(dot);
    }
  }

  var railHandle = null;
  var RAIL_IDS = [];
  function railBallPoint(id) {
    var el = document.querySelector('[data-rail-ball="' + id + '"]');
    if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (railHandle) {
      var p = railHandle.ballPos(id);
      var w = el.closest('.rail-world').getBoundingClientRect();
      return { x: w.left + p.x, y: w.top + p.y };
    }
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /* ---------- hero world: the app's real physics islands + the real ember bot ---------- */

  var railDemo = (function () {
    var scroller = $('#appScroll');
    var worldMap = $('#worldMap');
    var label = null;
    var started = false;
    var mounted = false;
    var handle = null;
    var gen = 0;
    var followRaf = 0;
    var labelBall = 'guide-les-1';
    var starEls = [];
    var starsData = [];

    /* ── 剧本引擎状态:交互暂停 + 视口门控 ── */
    var holdUntil = 0;      // 用户交互后剧本静默到这一刻(performance.now 基准)
    var worldEl = null;
    function worldVisible() {
      if (!worldEl) worldEl = document.querySelector('.world');
      if (!worldEl) return true;
      var r = worldEl.getBoundingClientRect();
      return r.bottom > -80 && r.top < window.innerHeight + 80;
    }
    function interact() { holdUntil = performance.now() + 8000; }
    function makeWait(alive) {
      // 可暂停等待:交互静默期与视口外不推进时间,恢复后继续演
      return function (ms) {
        return new Promise(function (res) {
          var remaining = ms, last = performance.now();
          function stepT() {
            if (!alive()) return res();
            var now2 = performance.now();
            if (worldVisible() && now2 >= holdUntil) remaining -= now2 - last;
            last = now2;
            if (remaining <= 0) return res();
            setTimeout(stepT, 90);
          }
          stepT();
        });
      };
    }
    worldMap.addEventListener('pointerdown', interact);

    var SECTIONS = [
      { id: 'guide-sec-1', zh: '示范课程', en: 'Demo Course', balls: [
        { id: 'guide-les-1', state: 'available', zh: '导入你的第一个课程', en: 'Import Your First Course' },
        { id: 'guide-les-2', state: 'locked', zh: '三栏布局导览', en: 'Tour of the Three Panes' },
        { id: 'guide-les-3', state: 'locked', zh: '解锁、掌握与复习', en: 'Unlocks, Mastery, Review' },
        { id: 'guide-exam-1', state: 'locked', exam: true, zh: '章节测验 · 小 BOSS 战', en: 'Chapter Quiz · Mini Boss' }
      ] }
    ];

    function ballEl(id) { return worldMap.querySelector('[data-rail-ball="' + id + '"]'); }
    function title(b) { return currentLang === 'zh' ? b.zh : b.en; }

    function ringSvg(kind) {
      var color = kind === 'gold' ? '#ffc800' : '#fff';
      var off = kind === 'gold' ? '0' : (kind === 'zero' ? '157' : '118');
      return '<svg class="ring" viewBox="0 0 56 56" aria-hidden="true">' +
        '<circle cx="28" cy="28" r="25" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="2.5"/>' +
        '<circle class="ring-fg" cx="28" cy="28" r="25" fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="157" stroke-dashoffset="' + off + '" transform="rotate(-90 28 28)"/></svg>';
    }

    function ballClass(b) {
      if (b.exam) return b.state === 'locked' ? 'bubble-exam-locked' : 'bubble-available';
      return 'bubble-' + b.state;
    }

    function buildSections() {
      RAIL_IDS.length = 0;
      var si = 0;
      var staticMode = !window.RailDemo;
      SECTIONS.forEach(function (sec) {
        si += 1;
        var secEl = document.createElement('div');
        secEl.className = 'rail-section';
        secEl.setAttribute('data-rail-section', sec.id);
        var sign = document.createElement('div');
        sign.className = 'map-signpost';
        sign.innerHTML = '<span class="sign-num">' + si + '</span><span class="sign-title"></span>';
        sign.querySelector('.sign-title').textContent = title(sec);
        var world = document.createElement('div');
        world.className = 'rail-world';
        world.setAttribute('data-rail-world', sec.id);
        var ropes = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        ropes.setAttribute('class', 'rail-ropes');
        ropes.setAttribute('data-rail-ropes', sec.id);
        world.appendChild(ropes);
        secEl.appendChild(sign);
        secEl.appendChild(world);
        worldMap.appendChild(secEl);

        var bi = 0;
        sec.balls.forEach(function (b) {
          var i = bi++;
          RAIL_IDS.push(b.id);
          var el = document.createElement('div');
          el.className = 'rail-ball ' + ballClass(b) + (b.state === 'available' ? ' next-cue' : '');
          el.setAttribute('data-rail-ball', b.id);
          el.title = title(b);
          if (staticMode) {
            el.style.left = (i % 2 ? 58 : 42) + '%';
            el.style.top = (8 + i * 20) + '%';
            el.style.margin = '-28px 0 0 -28px';
          }
          if (b.state === 'current') {
            el.innerHTML = '<svg class="bb bb-book" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>' + ringSvg('white') + '<span class="due" aria-hidden="true">!</span>';
          } else if (b.state === 'mastered') {
            el.innerHTML = '<span class="bb" aria-hidden="true">👑</span>' + ringSvg('gold');
          } else if (b.state === 'available') {
            el.innerHTML = '<span class="bb" aria-hidden="true">⭐</span>';
          } else {
            el.innerHTML = '<span class="bb" aria-hidden="true">🔒</span>';
          }
          world.appendChild(el);
          wireDrag(b.id, el);
          if (b.exam) {
            var st = document.createElement('div');
            st.className = 'rail-ball-stars';
            st.setAttribute('data-rail-stars', b.id);
            st.innerHTML = '<i>★</i><i>★</i><i>★</i>';
            world.appendChild(st);
            starEls.push(st);
          }
        });
      });
    }

    function wireDrag(id, el) {
      // app 同款 6px 分类:位移足量才算拖拽(软约束拖),否则是点击 → 轻推一下
      el.addEventListener('pointerdown', function (e) {
        if (!handle) return;
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        interact();
        var sx = e.clientX, sy = e.clientY;
        var dragging = false;
        function mv(ev) {
          if (!dragging) {
            if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
            dragging = true;
            var wr = el.closest('.rail-world').getBoundingClientRect();
            handle.beginDrag(id, sx - wr.left, sy - wr.top);
          }
          var r = el.closest('.rail-world').getBoundingClientRect();
          handle.moveDrag(ev.clientX - r.left, ev.clientY - r.top);
        }
        function up() {
          window.removeEventListener('pointermove', mv);
          window.removeEventListener('pointerup', up);
          if (dragging) handle.endDrag();
          else handle.nudge(id);
        }
        window.addEventListener('pointermove', mv);
        window.addEventListener('pointerup', up);
      });
    }

    // 演示布局:三列(每章一列)铺满 worldMap;球 88px(CSS)/物理半径 44。
    // 纵向间距按球径放大 + 哈希 x 抖动(确定性)+ 贪心防重叠。
    function hashStr(s2) {
      var h = 2166136261;
      for (var i = 0; i < s2.length; i++) { h ^= s2.charCodeAt(i); h = Math.imul(h, 16777619); }
      h ^= h >>> 16; h = Math.imul(h, 2246822507); h ^= h >>> 13;
      return h >>> 0;
    }
    function demoPositions() {
      var w = worldMap.clientWidth || 480;
      var pitchY = 168, topY = 88;
      var out = [];
      for (var i = 0; i < 4; i++) {
        out.push({ x: Math.round(w / 2 + (i % 2 ? 54 : -54)), y: Math.round(topY + i * pitchY) });
      }
      return out;
    }

    function ensureMount() {
      if (mounted) return;
      mounted = true;
      buildSections();
      if (window.RailDemo) {
        handle = railHandle = window.RailDemo.mountRail({
          panel: document.body,
          sky: $('#railSky'),
          orbCanvas: $('#railOrbs'),
          scroller: scroller,
          seed: 'seed-lookatstudy-guide',
          weather: (function () {
            var on = document.querySelector('#weatherDock button.on');
            return on ? on.getAttribute('data-weather') : undefined;
          })(),
          onRebuild: restoreDoneRopes,
          sections: SECTIONS.map(function (s, si) {
            return {
              id: s.id,
              world: worldMap.querySelector('[data-rail-world="' + s.id + '"]'),
              ropes: worldMap.querySelector('[data-rail-ropes="' + s.id + '"]'),
              ballRadius: window.innerWidth < 860 ? 26 : 44,
              positions: demoPositions(),
              balls: s.balls.map(function (b) { return { id: b.id, isExam: !!b.exam, locked: b.state === 'locked' }; })
            };
          })
        });
      }
      var lb = document.createElement('div');
      lb.className = 'rail-label';
      lb.setAttribute('id', 'railLabel');
      lb.setAttribute('data-i18n', 'rail.l2');
      lb.textContent = currentLang === 'zh' ? '导入你的第一个课程' : 'Import Your First Course';
      worldMap.appendChild(lb);
    }

    function burstAt(el) {
      var b = el.getBoundingClientRect();
      burst(b.left + b.width / 2, b.top + b.height / 2, document.body);
    }

    function followLoop() {
      if (!label) label = $('#railLabel');
      if (!label) return;
      followRaf = requestAnimationFrame(followLoop);
      var wr = worldMap.getBoundingClientRect();
      var vis = (wr.bottom > 0 && wr.top < window.innerHeight) ? 'visible' : 'hidden';
      label.style.visibility = vis;
      var p = railBallPoint(labelBall);
      label.style.left = p.x + 'px';
      label.style.top = (p.y + 32) + 'px';
      starEls.forEach(function (st) {
        st.style.visibility = vis;
        var e = railBallPoint(st.getAttribute('data-rail-stars'));
        st.style.left = e.x + 'px';
        st.style.top = (e.y + 32) + 'px';
      });
    }

    /* ── Scroll-Driven 剧本:世界屏滚动进度 p∈[0,1] 幂等映射演出状态(可逆倒带) ── */
    var doneRopeCount = 2;
    function restoreDoneRopes() {
      if (!handle) return;
      for (var i = 0; i < doneRopeCount; i++) {
        var rp = handle.ropeEl('guide-sec-1', i);
        if (rp) rp.setAttribute('class', 'rope done');
      }
    }
    function markRopeDone(secId, idx) {
      var rp = handle ? handle.ropeEl(secId, idx) : null;
      if (rp) rp.setAttribute('class', 'rope done');
    }

    var ICON_BOOK = '<svg class="bb bb-book" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/></svg>';
    var ICON_TARGET = '<svg class="bb" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/></svg>';
    var HTML_CROWN = '<span class="bb" aria-hidden="true">👑</span>' + ringSvg('gold');
    var HTML_STAR = '<span class="bb" aria-hidden="true">⭐</span>';
    var HTML_LOCK = '<span class="bb" aria-hidden="true">🔒</span>';
    var HTML_CURRENT = ICON_BOOK + ringSvg('zero') + '<span class="due" aria-hidden="true">!</span>';

    var ballStateCache = {};
    function setBall(id, html) {
      var el = ballEl(id);
      if (!el) return;
      if (ballStateCache[id] === html) return;
      ballStateCache[id] = html;
      el.innerHTML = html;
    }
    function setBallCls(id, cls) {
      var el = ballEl(id);
      if (!el) return;
      var want = 'rail-ball ' + cls;
      if (el.className !== want) el.className = want;
    }
    function ringSet(id, pct, color) {
      var el = ballEl(id);
      var r = el && el.querySelector('.ring-fg');
      if (!r) return;
      r.style.transition = 'none';
      var v = Math.max(0, Math.min(1, pct));
      r.setAttribute('stroke-dashoffset', String(Math.round((157 - 157 * v) * 10) / 10));
      if (color) r.setAttribute('stroke', color);
    }
    function findBall(id) {
      for (var si = 0; si < SECTIONS.length; si++) {
        var bs = SECTIONS[si].balls;
        for (var bi = 0; bi < bs.length; bi++) if (bs[bi].id === id) return bs[bi];
      }
      return null;
    }
    function setLabelTo(id) {
      labelBall = id;
      var b = findBall(id);
      if (label && b) label.textContent = title(b);
    }
    function burstOnce(id, prev, p, at) {
      if (prev < at && p >= at) {
        var el = ballEl(id);
        if (el) burstAt(el);
      }
    }
    function unlockOnce(id, prev, p, at) {
      if (prev < at && p >= at && handle) handle.unlock(id);
    }

    // 演出时间线:每球的解锁点/充能区间/完成点(全部滚动进度,可逆倒带)
    var TRACK = [
      { id: 'guide-les-1', fill: [0.06, 0.16], done: 0.16 },
      { id: 'guide-les-2', unlock: 0.26, fill: [0.28, 0.38], done: 0.38 },
      { id: 'guide-les-3', unlock: 0.48, fill: [0.50, 0.60], done: 0.60 },
      { id: 'guide-exam-1', exam: true, unlock: 0.68, stars: [0.72, 0.76, 0.80], pass: 0.86 }
    ];
    var FACT_AT = [0.16, 0.38, 0.60, 0.86];
    var BOT_STOPS = [[0.08, 'guide-les-1'], [0.28, 'guide-les-2'], [0.50, 'guide-les-3'], [0.70, 'guide-exam-1']];
    var botPerchTarget = 'guide-les-1';
    var factEls = [];
    function ropeSet(i, done) {
      if (!handle) return;
      var rp = handle.ropeEl('guide-sec-1', i);
      if (rp) rp.setAttribute('class', done ? 'rope done' : 'rope');
    }

    function applyWorld(p, prev) {
      var clamp01 = function (v) { return Math.max(0, Math.min(1, v)); };
      var rng = function (a, b) { return clamp01((p - a) / (b - a)); };

      for (var i = 0; i < TRACK.length; i++) {
        var t = TRACK[i];
        if (t.exam) {
          if (p < t.unlock) { setBallCls(t.id, 'bubble-exam-locked'); setBall(t.id, HTML_LOCK); continue; }
          unlockOnce(t.id, prev, p, t.unlock);
          var passed = p >= t.pass;
          setBallCls(t.id, passed ? 'bubble-exam-passed' : 'bubble-exam next-cue');
          setBall(t.id, ICON_TARGET);
          if (t.stars) {
            var stars = document.querySelector('[data-rail-stars="' + t.id + '"]');
            if (stars) {
              var dots = stars.querySelectorAll('i');
              for (var k = 0; k < dots.length; k++) dots[k].classList.toggle('lit', p >= t.stars[k]);
            }
          }
          if (passed) burstOnce(t.id, prev, p, t.pass);
          continue;
        }
        var doneNow = t.done !== undefined && p >= t.done;
        if (p < t.unlock) {
          setBallCls(t.id, 'bubble-locked');
          setBall(t.id, HTML_LOCK);
          continue;
        }
        unlockOnce(t.id, prev, p, t.unlock);
        if (doneNow) {
          setBallCls(t.id, 'bubble-mastered');
          setBall(t.id, HTML_CROWN);
          burstOnce(t.id, prev, p, t.done);
        } else if (t.fill && p >= t.fill[0]) {
          setBallCls(t.id, 'bubble-current');
          setBall(t.id, HTML_CURRENT);
          ringSet(t.id, 0.25 + 0.75 * rng(t.fill[0], t.fill[1]));
        } else {
          setBallCls(t.id, 'bubble-available next-cue');
          setBall(t.id, HTML_STAR);
        }
      }
      ropeSet(0, p >= 0.16);
      ropeSet(1, p >= 0.38);
      ropeSet(2, p >= 0.60);
      doneRopeCount = p >= 0.60 ? 3 : (p >= 0.38 ? 2 : (p >= 0.16 ? 1 : 0));
      for (var fi = 0; fi < FACT_AT.length; fi++) {
        if (factEls[fi]) factEls[fi].classList.toggle('in', p >= FACT_AT[fi]);
      }

      var target = 'guide-les-1';
      for (var m = 0; m < BOT_STOPS.length; m++) {
        if (p >= BOT_STOPS[m][0]) target = BOT_STOPS[m][1];
      }
      if (botPerchTarget !== target) {
        botPerchTarget = target;
        bot.perchTo(target);
        setLabelTo(target);
      }
    }

    function placeLabelStatic() {
      if (!label) label = $('#railLabel');
      var wsec = document.querySelector('.screen-world');
      var wvis = !wsec || (function () { var r = wsec.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; })();
      if (label) {
        label.style.visibility = wvis ? 'visible' : 'hidden';
        var pt = railBallPoint(labelBall);
        label.style.left = pt.x + 'px';
        label.style.top = (pt.y + 52) + 'px';
      }
      starEls.forEach(function (st) {
        var e = railBallPoint(st.getAttribute('data-rail-stars'));
        st.style.left = e.x + 'px';
        st.style.top = (e.y + 52) + 'px';
      });
    }

    function setWeatherUI(w) {
      var btns = document.querySelectorAll('#weatherDock button');
      for (var i = 0; i < btns.length; i++) {
        btns[i].classList.toggle('on', btns[i].getAttribute('data-weather') === w);
      }
      if (railHandle) railHandle.setWeather(w);
    }

    function start() {
      if (started) return;
      started = true;
      ensureMount();
      factEls = Array.prototype.slice.call(document.querySelectorAll('#mapFacts .fact-card'));
      if (REDUCED) { applyWorld(1, 0); placeLabelStatic(); bot.start(); return; }
      applyWorld(0, 0);
      followLoop();
      bot.start();
    }
    function stop() { gen++; }

    function rebuild() {
      // 语言切换:重建世界(回到时间线起点,滚动位置驱动重新推进)
      var wasMounted = mounted;
      if (handle) { handle.destroy(); handle = null; railHandle = null; }
      mounted = false;
      starEls = [];
      label = null;
      ballStateCache = {};
      botPerchTarget = 'guide-les-1';
      worldMap.textContent = '';
      started = false;
      if (wasMounted) start();
    }

    function worldFrame(p, prev) { applyWorld(p, prev); }

    var api = { start: start, stop: stop, frame: function () {}, rebuild: rebuild, restoreDoneRopes: restoreDoneRopes, interact: interact, setWeatherUI: setWeatherUI, worldFrame: worldFrame };
    window.__railDemo = api; // 调试/测试口
    return api;
  })();

  /* ---------- the real ember bot: perch on the physics ball / drag / throw / poke ---------- */

  var bot = (function () {
    var el = $('#railBot');
    var perchId = 'guide-les-1';
    var pos = { x: 0, y: 0 };      // viewport px (fixed positioning)
    var vel = { x: 0, y: 0 };
    var mode = 'perch';            // perch | drag | ballistic | return
    var raf = 0;
    var G = 0.5;

    function halfW() { return el.offsetWidth / 2; }
    function railVisible() {
      var w = document.querySelector('.screen-world');
      if (!w) return false;
      var r = w.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    }
    function clampPos() {
      pos.x = Math.max(halfW() * 0.6, Math.min(window.innerWidth - halfW() * 0.6, pos.x));
      pos.y = Math.max(74 + halfW() * 0.45, Math.min(window.innerHeight - 8, pos.y));
    }
    function render() {
      el.style.left = pos.x + 'px';
      el.style.top = pos.y + 'px';
    }
    function perchPoint() {
      var p = railBallPoint(perchId);
      return { x: p.x, y: p.y - el.offsetHeight * 0.3 };
    }
    function tick() {
      raf = requestAnimationFrame(tick);
      el.style.visibility = railVisible() ? 'visible' : 'hidden';
      if (mode === 'perch') {
        var t0 = perchPoint();
        pos.x += (t0.x - pos.x) * 0.16;
        pos.y += (t0.y - pos.y) * 0.16;
        clampPos();
        render();
        return;
      }
      if (mode === 'ballistic') {
        vel.y += G;
        pos.x += vel.x; pos.y += vel.y;
        var hw = halfW() * 0.6, top = 74, bottom = window.innerHeight - 8;
        if (pos.x < hw) { pos.x = hw; vel.x *= -0.55; }
        if (pos.x > window.innerWidth - hw) { pos.x = window.innerWidth - hw; vel.x *= -0.55; }
        if (pos.y > bottom) { pos.y = bottom; vel.y *= -0.55; vel.x *= 0.8; }
        if (pos.y < top) { pos.y = top; vel.y *= -0.55; }
        render();
        if (Math.abs(vel.x) < 0.5 && Math.abs(vel.y) < 0.5 && pos.y >= bottom - 1) { mode = 'return'; el.classList.remove('phys'); }
      } else if (mode === 'return') {
        var t = perchPoint();
        pos.x += (t.x - pos.x) * 0.08;
        pos.y += (t.y - pos.y) * 0.08;
        render();
        if (Math.hypot(t.x - pos.x, t.y - pos.y) < 2) { mode = 'perch'; el.classList.remove('phys'); }
      }
    }
    function start() {
      // 首帧直接落位(避免从 (0,0) 滑入);REDUCED 下就停在落点不再动
      el.style.visibility = railVisible() ? 'visible' : 'hidden';
      var t = perchPoint();
      pos.x = t.x; pos.y = t.y; clampPos(); render();
      if (REDUCED) return;
      if (!raf) raf = requestAnimationFrame(tick);
    }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }

    var down = null;
    el.addEventListener('pointerdown', function (e) {
      if (REDUCED) return;
      e.preventDefault();
      if (railDemo.interact) railDemo.interact();
      el.setPointerCapture(e.pointerId);
      down = { x: e.clientX, y: e.clientY, lx: 0, ly: 0, moved: 0 };
      vel.x = 0; vel.y = 0;
      mode = 'drag';
      el.classList.add('phys', 'dragging');
    });
    el.addEventListener('pointermove', function (e) {
      if (mode !== 'drag' || !down) return;
      var dx = e.clientX - down.x, dy = e.clientY - down.y;
      down.moved = Math.max(down.moved, Math.hypot(dx, dy));
      vel.x = dx - down.lx;
      vel.y = dy - down.ly;
      down.lx = dx; down.ly = dy;
      pos.x += vel.x; pos.y += vel.y;
      clampPos();
      render();
      down.x = e.clientX; down.y = e.clientY;
    });
    function release() {
      if (mode !== 'drag') return;
      el.classList.remove('dragging');
      if (down && down.moved < 6) {
        mode = 'return';
        el.classList.add('poke');
        setTimeout(function () { el.classList.remove('poke'); }, 600);
      } else {
        mode = 'ballistic';
      }
      down = null;
    }
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', function () {
      if (mode === 'drag') { el.classList.remove('dragging'); mode = 'return'; down = null; }
    });

    return {
      perchTo: function (id) {
        perchId = id;
        if (REDUCED) {
          var t = perchPoint();
          el.style.left = t.x + 'px';
          el.style.top = t.y + 'px';
        }
      },
      start: start,
      stop: stop
    };
  })();

  /* ---------- scroll-driven demo mappings:屏进度 p∈[0,1] → 面板状态(幂等可逆) ---------- */

  function applyChat(p) {
    var user = $('#chatUser'), ai = $('#chatAi'), proposal = $('#chatProposal');
    var applyBtn = $('#chatApply'), toast = $('#chatToast');
    var bar = $('#barClosures'), val = $('#valClosures');
    if (!user) return;
    user.classList.toggle('in', p > 0.05);
    var txt = dict()['demo.chat.ai'];
    var n = p <= 0.08 ? 0 : Math.round(txt.length * Math.min(1, (p - 0.08) / 0.30));
    if (ai.textContent.length !== n) ai.textContent = txt.slice(0, n);
    ai.classList.toggle('in', p > 0.08);
    ai.classList.toggle('typing', p > 0.08 && p < 0.38);
    // 导师出题:弹出 → 正确项点亮 → “答对”反馈
    var quiz = $('#tutorQuiz');
    if (quiz) {
      quiz.classList.toggle('in', p >= 0.42);
      quiz.classList.toggle('on', p >= 0.52);
      var opts = quiz.querySelectorAll('.quiz-opts span');
      for (var qi = 0; qi < opts.length; qi++) opts[qi].classList.toggle('picked', qi === 1 && p >= 0.52);
    }
    proposal.classList.toggle('in', p >= 0.62);
    proposal.classList.toggle('applied', p >= 0.70);
    applyBtn.classList.toggle('used', p >= 0.70 && p < 0.97);
    toast.classList.toggle('in', p >= 0.70);
    var mk = 0.41 + 0.37 * Math.max(0, Math.min(1, (p - 0.72) / 0.12));
    bar.style.transform = 'scaleX(' + (Math.round(mk * 1000) / 1000) + ')';
    val.textContent = Math.round(mk * 100) + '%';
  }

  var readSents = $$('#readText span');
  var readPanelEl = $('[data-demo="read"]');
  var CM_NODES = ['n0', 'n1', 'n2', 'n3'], CM_EDGES = ['e0', 'e1', 'e2'];
  function applyRead(p) {
    if (!readPanelEl) return;
    readPanelEl.classList.toggle('playing', p > 0.03 && p < 0.80);
    var idx = Math.min(readSents.length, Math.floor(p * 3.3));
    readSents.forEach(function (s, i) { s.classList.toggle('on', i === idx - 1); });
    // 画线成笔记:第二句高亮 + 笔记 chip(可倒带)
    if (readSents[1]) readSents[1].classList.toggle('noted', p >= 0.45);
    var note = $('#nbNote');
    if (note) note.classList.toggle('in', p >= 0.50);
    // 黑板概念图:节点逐个弹出,边按进度描画
    var nodeAt = [0.08, 0.30, 0.50, 0.68];
    for (var i = 0; i < CM_NODES.length; i++) {
      var nd = document.querySelector('.cm-node[data-cm="' + CM_NODES[i] + '"]');
      if (nd) nd.classList.toggle('on', p >= nodeAt[i]);
    }
    var edgeSeg = [[0.18, 0.34], [0.38, 0.52], [0.58, 0.72]];
    for (var e = 0; e < CM_EDGES.length; e++) {
      var ed = document.querySelector('.cm-edge[data-cm="' + CM_EDGES[e] + '"]');
      if (!ed) continue;
      var k = Math.max(0, Math.min(1, (p - edgeSeg[e][0]) / (edgeSeg[e][1] - edgeSeg[e][0])));
      ed.style.strokeDashoffset = String(Math.round(220 * (1 - k)));
    }
  }

  function applyCompanion(p) {
    var hero = $('.companion-hero');
    if (!hero) return;
    var lift = Math.max(0, 1 - p / 0.22);
    hero.style.transform = 'translateY(' + Math.round(lift * 90) + 'px)';
    hero.style.opacity = String(Math.max(0.15, 1 - lift * 0.85));
    var cards = $$('.comp-card');
    var at = [0.30, 0.46, 0.62];
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('in', p >= at[i]);
  }


  var importSources = $$('#pipeIn span');
  var importHub = $('#pipeHub');
  var ccDots = $$('#pipeOut .cc-map i');
  var ccPct = $('#ccPct');
  var importSources = $$('#pipeIn .src'), importHub = $('#pipeHub');
  var chargeFill = $('#chargeFill'), ccPct = $('#ccPct'), chargeCard = $('#pipeOut'), chargeText = $('#chargeText');
  var flyVec = [];
  function flyVecFor(i) {
    if (flyVec[i]) return flyVec[i];
    var el = importSources[i];
    el.style.transform = ''; el.style.opacity = '';
    var pr = el.getBoundingClientRect(), hr = importHub.getBoundingClientRect();
    flyVec[i] = {
      dx: hr.left + hr.width / 2 - (pr.left + pr.width / 2),
      dy: hr.top + hr.height / 2 - (pr.top + pr.height / 2)
    };
    return flyVec[i];
  }
  function applyImport(p, prev) {
    if (!importSources.length || !importHub) return;
    var N = importSources.length, anyFly = false, fill = 0;
    for (var i = 0; i < N; i++) {
      var t0 = 0.008 + i * (0.70 / N);
      var f0 = t0 + 0.02, f1 = f0 + 0.10;
      var el = importSources[i];
      var k = Math.max(0, Math.min(1, (p - f0) / (f1 - f0)));
      el.classList.toggle('marching', p >= t0 && p < f1);
      el.classList.toggle('absorbed', k >= 1);
      if (k > 0 && k < 1) {
        var v = flyVecFor(i);
        el.style.transform = 'translate(' + (v.dx * k).toFixed(1) + 'px,' + (v.dy * k).toFixed(1) + 'px) scale(' + (1 - 0.72 * k).toFixed(3) + ')';
        el.style.opacity = String(1 - 0.9 * k);
        anyFly = true;
      } else {
        el.style.transform = '';
        el.style.opacity = '';
      }
      fill += Math.max(0, Math.min(1, (p - (f1 - 0.04)) / 0.06)) / N;
    }
    importHub.classList.toggle('pulse', anyFly);
    if (chargeFill) chargeFill.style.transform = 'scaleX(' + (Math.round(fill * 1000) / 1000) + ')';
    if (ccPct) ccPct.textContent = Math.round(fill * 100) + '%';
    var done = fill >= 0.999;
    if (chargeCard) chargeCard.classList.toggle('done', done);
    if (chargeText) {
      var key = done ? 'import.parsed' : 'import.parsing';
      if (chargeText.getAttribute('data-state') !== key) {
        chargeText.setAttribute('data-state', key);
        chargeText.textContent = I18N[currentLang][key] || chargeText.textContent;
      }
    }
  }

  /* ---------- language dictionary accessor for demos ---------- */

  var currentLang = 'en';
  function dict() { return I18N[currentLang]; }

  /* ---------- 屏5:活体伴学 = app 真 Mascot(comp-demo.js 挂载,prop 驱动) ---------- */

  var compLive = (function () {
    var root = $('#compLive'), bubble = $('#compBubble');
    var demo = null;
    var speakTimer = 0, typeTimer = 0, poseTimer = 0, running = false;

    function mount() {
      if (demo || !window.CompDemoMount) return;
      var holder = $('#compMount');
      demo = window.CompDemoMount.mountCompanion(holder, {
        size: Math.min(250, (holder.parentElement && holder.parentElement.clientWidth) || 240)
      });
      demo.onPoke(function () {
        demo.set({ expression: 'surprised', pose: 'hop' });
        setTimeout(function () { if (demo) demo.set({ expression: 'happy', pose: 'float' }); }, 950);
      });
    }
    function speak() {
      if (!running || !demo) return;
      var lines = I18N[currentLang].compLines || [];
      var text = lines[Math.floor(Math.random() * lines.length)] || '';
      bubble.classList.add('in');
      bubble.textContent = '';
      demo.set({ expression: 'talking', pose: 'float' });
      var i2 = 0, flip = false;
      typeTimer = setInterval(function () {
        i2 += 1;
        flip = !flip;
        bubble.textContent = text.slice(0, i2);
        demo.set({ viseme: flip ? 'A' : 'closed', openScale: flip ? 0.55 : 0.12 });
        if (i2 >= text.length) {
          clearInterval(typeTimer);
          demo.set({ viseme: 'closed', openScale: 0, expression: 'base' });
          speakTimer = setTimeout(function () {
            bubble.classList.remove('in');
            speakTimer = setTimeout(speak, 1600);
          }, 2800);
        }
      }, 62);
    }
    return {
      start: function () {
        if (running) return;
        running = true;
        mount();
        if (!demo) return;
        if (REDUCED) {
          var lines = I18N[currentLang].compLines || [];
          bubble.textContent = lines[0] || '';
          bubble.classList.add('in');
          return;
        }
        demo.set({ pose: 'wave', expression: 'happy' });
        poseTimer = setTimeout(function () { if (demo) demo.set({ pose: 'float', expression: 'base' }); }, 1500);
        speakTimer = setTimeout(speak, 1000);
      },
      stop: function () {
        running = false;
        clearTimeout(speakTimer); clearTimeout(typeTimer); clearTimeout(poseTimer);
        bubble.classList.remove('in');
        if (demo) demo.set({ pose: 'float', expression: 'base', viseme: 'closed', openScale: 0 });
      }
    };
  })();

  /* ---------- boot ---------- */

  function boot() {
    currentLang = initialLang();
    apply(currentLang);

    // 世界首屏(hero):页面可交互即启动。REDUCED 走静态完成态分支。
    railDemo.start();

    // Scroll-Driven:每屏一个映射器,全局 rAF 按各屏滚动进度驱动(可逆倒带)。
    var scrollScreens = [
      { el: $('[data-screen="import"]'), apply: applyImport },
      { el: $('.screen-world'), apply: function (p, prev) { railDemo.worldFrame(p, prev); } },
      { el: $('[data-screen="chat"]'), apply: applyChat },
      { el: $('[data-screen="read"]'), apply: applyRead },
      { el: $('[data-screen="companion"]'), apply: applyCompanion }
    ].filter(function (s) { return s.el; });
    // 文案卡入场:非首屏的卡随所在屏进度挂 .seen(可逆)
    scrollScreens.forEach(function (s2) {
      if (s2.el.getAttribute('data-screen') !== 'import') {
        s2.copy = s2.el.querySelector('.side-copy, .world-copy');
      }
    });

    function driveAll() {
      var vh = window.innerHeight;
      for (var i = 0; i < scrollScreens.length; i++) {
        var s = scrollScreens[i];
        var rect = s.el.getBoundingClientRect();
        var denom = rect.height - vh;
        var p = denom > 0 ? Math.max(0, Math.min(1, -rect.top / denom)) : (rect.top < 0 ? 1 : 0);
        var last = s.last === undefined ? -1 : s.last;
        if (Math.abs(p - last) < 0.0004) continue;
        s.last = p;
        s.apply(p, last < 0 ? p : last);
        if (s.copy) s.copy.classList.toggle('seen', p > 0.01 || p >= 1);
      }
    }
    if (REDUCED) {
      scrollScreens.forEach(function (s) { s.apply(1, 0); s.last = 1; });
    } else {
      (function frame() { requestAnimationFrame(frame); driveAll(); })();
    }

    // 跳滚:屏内滚动自由推进演示;越过屏界(演示已完再下滚/在屏顶再上滚)时
    // 平滑跳到相邻屏顶——分页手感,不劫持屏内滚轮。
    function initWheelJump() {
      if (REDUCED) return;
      var jumping = false;
      var jumpScroll = $('#appScroll');
      var jumpTo = function (top) {
        jumping = true;
        jumpScroll.scrollTo({ top: top, behavior: 'smooth' });
        setTimeout(function () { jumping = false; driveAll(); }, 580);
      };
      jumpScroll.addEventListener('wheel', function (e) {
        if (jumping) { e.preventDefault(); return; }
        var vh = window.innerHeight;
        var idx = -1, rect = null, p = 0;
        for (var i = 0; i < scrollScreens.length; i++) {
          var r = scrollScreens[i].el.getBoundingClientRect();
          if (r.top <= vh * 0.5 && r.bottom > vh * 0.5) { idx = i; rect = r; break; }
        }
        if (idx < 0) return;
        var denom = rect.height - vh;
        p = denom > 0 ? -rect.top / denom : 1;
        if (e.deltaY > 0 && p > 0.90 && idx + 1 < scrollScreens.length) {
          e.preventDefault();
          var ns = scrollScreens[idx + 1];
          var depth = ns.el.getAttribute('data-screen') === 'chat' ? 0.39 : 0.085;
          jumpTo(ns.el.offsetTop + Math.round((ns.el.offsetHeight - vh) * depth));
        } else if (e.deltaY < 0 && -rect.top < 160 && idx > 0) {
          e.preventDefault();
          jumpTo(scrollScreens[idx - 1].el.offsetTop);
        }
      }, { passive: false });
    }
    initWheelJump();

    // marquee: duplicate content once for a seamless -50% loop
    var track = $('#marqueeTrack');
    if (track && !REDUCED) track.innerHTML += track.innerHTML;

    var toggle = $('#langToggle');
    if (toggle) {
      toggle.addEventListener('click', function () {
        currentLang = document.documentElement.lang === 'zh-CN' ? 'en' : 'zh';
        apply(currentLang);
        // 文案跟字典走:世界重建 + 各屏映射器强制重放
        scrollScreens.forEach(function (s) { s.last = undefined; });
        if (railDemo.rebuild) railDemo.rebuild();
        if (!REDUCED) driveAll(); else scrollScreens.forEach(function (s) { s.apply(1, 0); });
      });
    }


    var compStage = $('[data-screen="companion"]');
    if (compStage && 'IntersectionObserver' in window) {
      var io3 = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) compLive.start(); else compLive.stop();
        });
      }, { threshold: 0.18 });
      io3.observe(compStage);
    } else {
      compLive.start();
    }

    window.addEventListener('resize', function () { flyVec.length = 0; }, { passive: true });

    var dock = $('#weatherDock');
    if (dock) {
      dock.addEventListener('click', function (e) {
        var btn = e.target.closest('button[data-weather]');
        if (!btn) return;
        railDemo.interact(); // 手动切天气 = 交互,剧本让位 8s
        railDemo.setWeatherUI(btn.getAttribute('data-weather'));
      });
    }

    var copyBtn = $('#copyBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = $('#srcCode').textContent;
        var done = function () {
          copyBtn.textContent = I18N[currentLang]['gs.copied'];
          setTimeout(function () { copyBtn.textContent = I18N[currentLang]['gs.copy']; }, 1600);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, done);
        } else { done(); }
      });
    }
  }

  boot();
})();

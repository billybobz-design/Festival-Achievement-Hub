(function () {
  "use strict";

  var status = document.getElementById("connection");
  var retry = document.getElementById("retry");
  var lotteryButton = document.getElementById("nav-lottery");
  var prizesButton = document.getElementById("nav-prizes");
  var page = document.getElementById("lottery-page");
  var pageTitle = document.getElementById("lottery-page-title");
  var pageContent = document.getElementById("lottery-page-content");
  var contextCache = null;
  var pageMode = "lotteries";
  var drawBusy = false;

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setIcon(container, icon, label) {
    if (/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/i.test(icon || "")) {
      var image = document.createElement("img");
      image.src = icon;
      image.alt = label || "";
      container.append(image);
    } else {
      container.textContent = icon || "🎁";
    }
  }

  function renderMain(context) {
    contextCache = context;
    var items = context.achievements.filter(function (item) { return item.enabled && (!item.hidden || item.unlocked); });
    var unlocked = items.filter(function (item) { return item.unlocked; }).length;
    var percent = items.length ? Math.round(unlocked / items.length * 100) : 0;
    var lotteries = Array.isArray(context.lotteries) ? context.lotteries : [];

    document.getElementById("total-count").textContent = unlocked + " / " + items.length;
    document.getElementById("progress-fill").style.width = percent + "%";
    document.querySelector(".progress-track").setAttribute("aria-valuenow", String(percent));
    document.getElementById("event-date").textContent = context.event.dateLabel;
    status.textContent = items.length && unlocked === items.length ? "全部证据已收集。谢谢你走完这一夜。" : "已收集 " + unlocked + " 枚成就。下一条线索，等你发现。";
    lotteryButton.disabled = !lotteries.length;

    var chapters = document.getElementById("chapters");
    chapters.replaceChildren();
    var categories = context.event.categories.slice().sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    var taskLine = context.event.taskLine || [];
    if (taskLine.length) categories.unshift({ id: "__task_line__", name: "主线任务", description: "按顺序探索，完成前一站后开启下一站。" });
    if (items.some(function (item) { return !item.categoryId; })) categories.push({ id: "", name: "其他线索", description: "现场追加的探索记录" });
    categories.forEach(function (category, index) {
      var achievements = category.id === "__task_line__"
        ? taskLine.map(function (id) { return items.find(function (item) { return item.id === id; }); }).filter(Boolean)
        : items.filter(function (item) { return item.categoryId === category.id && taskLine.indexOf(item.id) < 0; }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
      if (!achievements.length) return;
      var chapter = element("section", "chapter");
      var heading = element("div", "chapter-head");
      heading.append(element("span", "chapter-number", String(index + 1).padStart(2, "0")), element("h3", "", category.name), element("span", "chapter-count", achievements.filter(function (item) { return item.unlocked; }).length + " / " + achievements.length));
      chapter.append(heading, element("p", "chapter-description", category.description));
      var grid = element("div", "achievement-grid");
      achievements.forEach(function (item) {
        var card = element("article", "achievement" + (item.unlocked ? " is-unlocked" : ""));
        var top = element("div", "achievement-top");
        var icon = element("span", "achievement-icon");
        setIcon(icon, item.icon, item.name);
        var blocked = !item.unlocked && taskLine.slice(0, Math.max(0, taskLine.indexOf(item.id))).some(function (id) { return !context.achievements.some(function (entry) { return entry.id === id && entry.unlocked; }); });
        top.append(icon, element("span", "achievement-state", item.unlocked ? "✓ 已解锁" : blocked ? "前置任务未完成" : "待发现"));
        if (blocked) card.classList.add("is-blocked");
        if (item.hintEnabled) {
          card.tabIndex = 0;
          card.setAttribute("role", "button");
          card.setAttribute("aria-label", "查看" + item.name + "的提示");
          function showHint() {
            pageMode = "hint";
            page.hidden = false;
            document.body.classList.add("page-open");
            pageTitle.textContent = item.name;
            pageContent.replaceChildren(element("p", "draw-description", item.hintText || "暂无文字提示"));
            if (item.hintImage) {
              var hintImage = element("img", "hint-image");
              hintImage.src = item.hintImage;
              hintImage.alt = item.name + "提示";
              pageContent.append(hintImage);
            }
          }
          card.addEventListener("click", showHint);
          card.addEventListener("keydown", function (event) { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showHint(); } });
        }
        card.append(top, element("h4", "", item.name), element("p", "", item.description));
        grid.append(card);
      });
      chapter.append(grid);
      chapters.append(chapter);
    });
  }

  function prizeCard(prize) {
    var card = element("article", "draw-prize");
    var icon = element("span", "draw-prize-icon");
    setIcon(icon, prize.icon, prize.name);
    var copy = element("div", "draw-prize-copy");
    copy.append(element("strong", "", prize.name));
    if (prize.description) copy.append(element("p", "", prize.description));
    if (prize.remaining !== undefined) copy.append(element("small", "", "剩余 " + prize.remaining + " 份"));
    card.append(icon, copy);
    return card;
  }

  function renderLotteryList() {
    pageTitle.textContent = "终局抽签";
    pageContent.replaceChildren();
    var lotteries = contextCache && Array.isArray(contextCache.lotteries) ? contextCache.lotteries : [];
    var intro = element("div", "draw-intro");
    intro.append(element("span", "", "ONE WISH / ONE CHANCE"), element("h3", "", "愿望只回答一次"), element("p", "", "查看奖品与条件。点击抽取后，结果将立即由服务器锁定，无法重来。"));
    pageContent.append(intro);
    if (!lotteries.length) {
      pageContent.append(element("div", "draw-empty", "今晚的抽签档案尚未开启。"));
      return;
    }
    lotteries.forEach(function (lottery) {
      var card = element("article", "draw-card");
      var head = element("div", "draw-card-head");
      var title = element("div", "");
      title.append(element("span", "", "DRAW NO. " + String(lottery.id).padStart(3, "0")), element("h3", "", lottery.name));
      head.append(title, element("em", lottery.eligible ? "is-ready" : "", lottery.eligible ? "可以参加" : "条件未满足"));
      card.append(head);
      if (lottery.description) card.append(element("p", "draw-description", lottery.description));
      var prizeList = element("div", "draw-prize-list");
      lottery.prizes.forEach(function (prize) { prizeList.append(prizeCard(prize)); });
      card.append(prizeList);
      var draw = element("button", "draw-action", lottery.eligible ? "揭开愿望的答案" : "集齐指定成就后可参加");
      draw.type = "button";
      draw.disabled = !lottery.eligible;
      draw.addEventListener("click", function () { drawLottery(lottery, draw); });
      card.append(draw);
      pageContent.append(card);
    });
  }

  function renderWins() {
    pageTitle.textContent = "我的奖品";
    pageContent.replaceChildren();
    var wins = contextCache && Array.isArray(contextCache.wins) ? contextCache.wins : [];
    var intro = element("div", "draw-intro");
    intro.append(element("span", "", "PRIZE ARCHIVE"), element("h3", "", "愿望留下的证物"), element("p", "", "兑奖时请将本页和中奖编号出示给工作人员。请勿清除当前浏览器数据。"));
    pageContent.append(intro);
    if (!wins.length) {
      pageContent.append(element("div", "draw-empty", "暂时没有中奖记录。参加抽签后，结果会保存在这里。"));
      return;
    }
    wins.forEach(function (win) {
      var card = element("article", "win-card");
      var icon = element("span", "win-icon");
      setIcon(icon, win.prizeIcon, win.prizeName);
      var copy = element("div", "win-copy");
      copy.append(element("small", "", win.lotteryName), element("h3", "", win.prizeName));
      if (win.prizeDescription) copy.append(element("p", "", win.prizeDescription));
      var code = element("div", "win-code");
      code.append(element("span", "", "中奖编号"), element("strong", "", win.participantCode));
      copy.append(code, element("time", "", new Date(win.drawnAt).toLocaleString("zh-CN")));
      card.append(icon, copy);
      pageContent.append(card);
    });
  }

  function renderDrawResult(result) {
    pageMode = "result";
    pageTitle.textContent = "抽签结果";
    pageContent.replaceChildren();
    var box = element("div", "draw-result" + (result.status === "winner" ? " is-winner" : ""));
    if (result.status === "winner" && result.draw) {
      var icon = element("span", "draw-result-icon");
      setIcon(icon, result.draw.prizeIcon, result.draw.prizeName);
      box.append(icon, element("small", "", "THE WISH ANSWERED"), element("h3", "", "恭喜获得 " + result.draw.prizeName));
      if (result.draw.prizeDescription) box.append(element("p", "", result.draw.prizeDescription));
      var code = element("div", "win-code");
      code.append(element("span", "", "中奖编号"), element("strong", "", result.draw.participantCode));
      box.append(code);
    } else {
      var messages = {
        no_prize: ["这次愿望没有回应", "本次未中奖，参与机会已经使用。"],
        already: ["档案已经封存", "你已经参加过这个抽奖，请查看“我的奖品”。"],
        not_eligible: ["愿望尚未完整", "请先集齐抽奖要求的全部成就。"],
        sold_out: ["回礼已经散尽", "这个抽奖项目的奖品已经抽完。"]
      };
      var message = messages[result.status] || ["抽签暂时中断", "请稍后重新打开页面查看结果。"];
      box.append(element("span", "draw-result-symbol", "✦"), element("h3", "", message[0]), element("p", "", message[1]));
    }
    var done = element("button", "draw-result-done", "返回活动");
    done.type = "button";
    done.addEventListener("click", closePage);
    box.append(done);
    pageContent.append(box);
  }

  async function drawLottery(lottery, button) {
    if (drawBusy) return;
    drawBusy = true;
    button.disabled = true;
    button.textContent = "正在询问愿望…";
    try {
      var payload = await window.NCPAActivity.drawLottery(lottery.id);
      contextCache.lotteries = payload.lotteries;
      contextCache.wins = payload.wins;
      renderMain(contextCache);
      renderDrawResult(payload.result);
    } catch (error) {
      button.disabled = false;
      button.textContent = lottery.eligible ? "重新尝试抽取" : "集齐指定成就后可参加";
      button.before(element("p", "draw-error", error.message || "抽奖暂不可用，请稍后再试。"));
    } finally {
      drawBusy = false;
    }
  }

  function openPage(mode) {
    pageMode = mode;
    page.hidden = false;
    document.body.classList.add("page-open");
    if (mode === "wins") renderWins(); else renderLotteryList();
    page.scrollTop = 0;
  }

  function closePage() {
    page.hidden = true;
    document.body.classList.remove("page-open");
  }

  async function connect(silent) {
    if (drawBusy) return;
    retry.hidden = true;
    lotteryButton.disabled = true;
    if (!silent) status.textContent = "正在连接你的活动档案…";
    try {
      if (!window.NCPAActivity) throw new Error("请先将 ZIP 活动包导入 NCPA 平台，并从活动页打开。");
      renderMain(await window.NCPAActivity.getContext({ themedNavigation: true }));
      if (!page.hidden) {
        if (pageMode === "wins") renderWins(); else if (pageMode === "lotteries") renderLotteryList();
      }
    } catch (error) {
      status.textContent = error.message || "暂时无法读取活动，请重新连接。";
      retry.hidden = false;
    }
  }

  lotteryButton.addEventListener("click", function () { openPage("lotteries"); });
  prizesButton.addEventListener("click", function () { openPage("wins"); });
  document.getElementById("close-lottery-page").addEventListener("click", closePage);
  retry.addEventListener("click", function () { connect(false); });
  window.addEventListener("focus", function () { connect(true); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) connect(true); });
  connect(false);
  window.setInterval(function () { if (!document.hidden && page.hidden) connect(true); }, 10000);
}());

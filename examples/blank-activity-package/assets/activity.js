(function () {
  "use strict";

  var elements = {
    eventEyebrow: document.getElementById("event-eyebrow"),
    eventName: document.getElementById("event-name"),
    eventSubtitle: document.getElementById("event-subtitle"),
    eventDate: document.getElementById("event-date"),
    eventId: document.getElementById("event-id"),
    progressCount: document.getElementById("progress-count"),
    progressFill: document.getElementById("progress-fill"),
    progressTrack: document.querySelector(".progress-track"),
    connectionStatus: document.getElementById("connection-status"),
    categoryList: document.getElementById("category-list"),
    refresh: document.getElementById("refresh"),
    scanner: document.getElementById("open-scanner"),
    scannerDescription: document.getElementById("scanner-description"),
    errorPanel: document.getElementById("error-panel"),
    errorMessage: document.getElementById("error-message"),
    retry: document.getElementById("retry"),
    achievementTemplate: document.getElementById("achievement-template")
  };

  function createElement(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setIcon(container, icon, label) {
    container.replaceChildren();
    if (/^(data:image\/(png|jpeg|webp);base64,|https?:\/\/)/i.test(icon)) {
      var image = document.createElement("img");
      image.src = icon;
      image.alt = label;
      image.loading = "lazy";
      container.append(image);
    } else {
      container.textContent = icon;
    }
  }

  function renderAchievement(achievement) {
    var card = elements.achievementTemplate.content.firstElementChild.cloneNode(true);
    card.classList.toggle("is-unlocked", Boolean(achievement.unlocked));
    setIcon(card.querySelector(".achievement-icon"), achievement.icon, achievement.name);
    card.querySelector("h4").textContent = achievement.name;
    card.querySelector("p").textContent = achievement.description;
    card.querySelector(".achievement-state").textContent = achievement.unlocked ? "✓ 已解锁" : "待解锁";
    return card;
  }

  function render(context) {
    var achievements = context.achievements.filter(function (item) { return item.enabled; });
    var unlocked = achievements.filter(function (item) { return item.unlocked; }).length;
    var percent = achievements.length ? Math.round(unlocked / achievements.length * 100) : 0;
    elements.eventEyebrow.textContent = context.event.eyebrow;
    elements.eventName.textContent = context.event.name;
    elements.eventSubtitle.textContent = context.event.subtitle;
    elements.eventDate.textContent = context.event.dateLabel;
    elements.eventId.textContent = context.event.eventId;
    elements.progressCount.textContent = unlocked + " / " + achievements.length;
    elements.progressFill.style.width = percent + "%";
    elements.progressTrack.setAttribute("aria-valuenow", String(percent));
    elements.connectionStatus.textContent = achievements.length === 0
      ? "当前活动还没有成就。"
      : unlocked === achievements.length
        ? "全部成就已经收集完成。"
        : "已解锁 " + unlocked + " 个成就，继续扫描现场二维码。";

    elements.categoryList.replaceChildren();
    var categories = context.event.categories.slice().sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    if (achievements.some(function (item) { return !item.categoryId; })) {
      categories.push({ id: "", name: "其他成就", description: "未指定分类的活动成就", sortOrder: 1000000 });
    }
    categories.forEach(function (category) {
      var items = achievements.filter(function (item) { return item.categoryId === category.id; }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
      if (!items.length) return;
      var section = createElement("section", "category-block");
      var heading = createElement("div", "category-heading");
      heading.append(createElement("h3", "", category.name), createElement("span", "", items.filter(function (item) { return item.unlocked; }).length + " / " + items.length));
      section.append(heading);
      if (category.description) section.append(createElement("p", "category-description", category.description));
      var grid = createElement("div", "achievement-grid");
      items.forEach(function (achievement) { grid.append(renderAchievement(achievement)); });
      section.append(grid);
      elements.categoryList.append(section);
    });

    elements.scanner.hidden = !context.event.webScannerEnabled;
    elements.scannerDescription.textContent = context.event.webScannerEnabled
      ? "可以使用网页摄像头，也可以使用手机系统相机扫描现场二维码。"
      : "推荐使用手机系统相机扫描现场二维码；管理员也可以在活动设置中开启网页摄像头。";
  }

  function showError(error) {
    elements.errorMessage.textContent = error instanceof Error ? error.message : "无法连接活动平台，请稍后重试。";
    elements.errorPanel.hidden = false;
    elements.connectionStatus.textContent = "活动资料读取失败。";
  }

  async function connect() {
    elements.refresh.disabled = true;
    elements.errorPanel.hidden = true;
    elements.connectionStatus.textContent = "正在连接活动平台……";
    try {
      if (!window.NCPAActivity) throw new Error("请将 ZIP 活动包导入平台，并从活动页面打开。");
      render(await window.NCPAActivity.getContext());
    } catch (error) {
      showError(error);
    } finally {
      elements.refresh.disabled = false;
    }
  }

  elements.refresh.addEventListener("click", connect);
  elements.retry.addEventListener("click", connect);
  elements.scanner.addEventListener("click", async function () {
    elements.scanner.disabled = true;
    try {
      await window.NCPAActivity.openScanner();
    } catch (error) {
      showError(error);
    } finally {
      elements.scanner.disabled = false;
    }
  });
  window.addEventListener("focus", connect);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) connect(); });
  connect();
}());

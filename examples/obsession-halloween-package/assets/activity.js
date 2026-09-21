(function () {
  "use strict";
  var status = document.getElementById("connection");
  var scan = document.getElementById("scan");
  var retry = document.getElementById("retry");
  function element(tag, className, text) {
    var node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function render(context) {
    var items = context.achievements.filter(function (item) { return item.enabled && (!item.hidden || item.unlocked); });
    var unlocked = items.filter(function (item) { return item.unlocked; }).length;
    var percent = items.length ? Math.round(unlocked / items.length * 100) : 0;
    document.getElementById("total-count").textContent = unlocked + " / " + items.length;
    document.getElementById("progress-fill").style.width = percent + "%";
    document.querySelector(".progress-track").setAttribute("aria-valuenow", String(percent));
    document.getElementById("event-date").textContent = context.event.dateLabel;
    status.textContent = items.length && unlocked === items.length ? "全部证据已收集。谢谢你走完这一夜。" : "已收集 " + unlocked + " 枚成就。下一条线索，等你发现。";
    var chapters = document.getElementById("chapters");
    chapters.replaceChildren();
    var categories = context.event.categories.slice().sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    if (items.some(function (item) { return !item.categoryId; })) categories.push({ id: "", name: "其他线索", description: "现场追加的探索记录" });
    categories.forEach(function (category, index) {
      var achievements = items.filter(function (item) { return item.categoryId === category.id; }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
      var chapter = element("section", "chapter");
      var heading = element("div", "chapter-head");
      heading.append(element("span", "chapter-number", String(index + 1).padStart(2, "0")), element("h3", "", category.name), element("span", "chapter-count", achievements.filter(function (item) { return item.unlocked; }).length + " / " + achievements.length));
      chapter.append(heading, element("p", "chapter-description", category.description));
      var grid = element("div", "achievement-grid");
      achievements.forEach(function (item) {
        var card = element("article", "achievement" + (item.unlocked ? " is-unlocked" : ""));
        var top = element("div", "achievement-top");
        var icon = element("span", "achievement-icon");
        if (/^(data:image\/(png|jpeg|webp);base64,|https:\/\/)/i.test(item.icon)) {
          var image = document.createElement("img"); image.src = item.icon; image.alt = ""; image.loading = "lazy"; icon.append(image);
        } else { icon.textContent = item.icon; }
        top.append(icon, element("span", "achievement-state", item.unlocked ? "✓ 已解锁" : "待发现"));
        card.append(top, element("h4", "", item.name), element("p", "", item.description));
        grid.append(card);
      });
      chapter.append(grid); chapters.append(chapter);
    });
  }
  async function connect() {
    retry.hidden = true; scan.disabled = true;
    status.textContent = "正在连接你的活动档案…";
    try {
      if (!window.NCPAActivity) throw new Error("请先将 ZIP 活动包导入 NCPA 平台，并从活动页打开。");
      render(await window.NCPAActivity.getContext());
      scan.disabled = false;
    } catch (error) {
      status.textContent = error.message || "暂时无法读取活动，请重新连接。";
      retry.hidden = false;
    }
  }
  scan.addEventListener("click", async function () {
    scan.disabled = true;
    try { await window.NCPAActivity.openScanner(); }
    catch (error) { status.textContent = error.message || "扫码暂不可用，请用手机系统相机扫描现场二维码。"; }
    finally { scan.disabled = false; }
  });
  retry.addEventListener("click", connect);
  connect();
}());

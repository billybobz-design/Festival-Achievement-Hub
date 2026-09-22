(function () {
  "use strict";

  var sequence = 0;
  var pending = new Map();

  function request(method, params, retryEnabled) {
    if (window.parent === window) return Promise.reject(new Error("活动包未在平台中运行"));
    sequence += 1;
    var requestId = "ncpa-" + Date.now() + "-" + sequence;
    return new Promise(function (resolve, reject) {
      function send() {
        window.parent.postMessage({
          source: "ncpa-activity-package",
          type: "request",
          requestId: requestId,
          method: method,
          params: params,
        }, "*");
      }
      var retryTimer = retryEnabled === false ? null : window.setInterval(send, 500);
      var timer = window.setTimeout(function () {
        window.clearInterval(retryTimer);
        pending.delete(requestId);
        reject(new Error("平台响应超时"));
      }, 8000);
      pending.set(requestId, { resolve: resolve, reject: reject, timer: timer, retryTimer: retryTimer });
      send();
    });
  }

  window.addEventListener("message", function (event) {
    var message = event.data;
    if (!message || message.source !== "ncpa-activity-host" || message.type !== "response") return;
    var operation = pending.get(message.requestId);
    if (!operation) return;
    window.clearTimeout(operation.timer);
    window.clearInterval(operation.retryTimer);
    pending.delete(message.requestId);
    if (message.ok) operation.resolve(message.value);
    else operation.reject(new Error(message.error || "平台操作失败"));
  });

  Object.defineProperty(window, "NCPAActivity", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      version: 1,
      getContext: function () { return request("getContext"); },
      openScanner: function () { return request("openScanner"); },
      openLotteries: function () { return request("openLotteries"); },
      openPrizes: function () { return request("openPrizes"); },
      drawLottery: function (lotteryId) { return request("drawLottery", { lotteryId: lotteryId }, false); },
    }),
  });
}());

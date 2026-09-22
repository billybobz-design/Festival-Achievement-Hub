# 空白活动包模板 2.0

可直接上传 `blank-activity-package.zip` 创建测试活动，也可以复制源文件后交给其他 AI 修改。

## 文件结构

- `manifest.json`：活动包身份、版本和入口页面。
- `festival-config.json`：活动信息、分类、成就、领取码和网页扫码开关。
- `index.html`：手机活动页面结构。
- `assets/theme.css`：全部视觉样式。
- `assets/activity.js`：通过平台 SDK 获取成就和进度、打开扫码页面。

## 必须同步修改的字段

复制为新活动时，必须同时修改 `manifest.json` 与 `festival-config.json` 中的 `eventId`，两个值必须完全相同。建议同时提升 `manifest.json` 的 `version`。

每个成就的 `id` 和 `claimCode` 必须在当前活动内唯一。二维码打印后不要再修改 `eventId` 或 `claimCode`，否则旧二维码会失效。

`categoryId` 必须等于现有分类的 `id`，或设为空字符串表示默认分类。`claimLimit` 是该成就的领取人数上限，不是整个活动的人数上限。

`webScannerEnabled` 默认是 `false`。关闭时参与者仍可使用手机系统相机扫描二维码；需要网页内摄像头时，可在管理员活动设置中开启，但浏览器通常要求 HTTPS。

## 平台边界

活动包负责视觉与内容展示。扫码领取、服务器校验、抽奖和“我的奖品”都由外层平台提供，不应在活动包里重复实现。页面通过 `/activity-package-sdk.js` 暴露的 `window.NCPAActivity.getContext()` 与 `openScanner()` 和平台通信。

不要把 `festival-config.json` 单独发布给参与者，其中包含二维码领取识别码。平台导入时会把它写入受保护的数据库，并不会把该 JSON 当作静态资源公开。

打包时必须让 `manifest.json`、`festival-config.json` 和 `index.html` 位于 ZIP 根目录，不能在 ZIP 外面再套一层文件夹。

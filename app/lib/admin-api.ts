export type AdminApiIssue = {
  path?: string;
  message?: string;
};

type AdminApiErrorPayload = {
  code?: string;
  error?: string;
  issues?: AdminApiIssue[];
};

export class AdminApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly issues: AdminApiIssue[] = [],
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

function fallbackCode(status: number) {
  if (status === 400) return "BAD_REQUEST";
  if (status === 401) return "AUTH_REQUIRED";
  if (status === 403) return "ACCESS_REJECTED";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 413) return "PAYLOAD_TOO_LARGE";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "REQUEST_FAILED";
}

function isErrorPayload(value: unknown): value is AdminApiErrorPayload {
  return typeof value === "object" && value !== null;
}

export async function readAdminJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  let payload: unknown;
  try {
    payload = body ? JSON.parse(body) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorPayload = isErrorPayload(payload) ? payload : {};
    throw new AdminApiError(
      response.status,
      errorPayload.code || fallbackCode(response.status),
      errorPayload.error || response.statusText || "request failed",
      Array.isArray(errorPayload.issues) ? errorPayload.issues : [],
    );
  }

  if (payload === null) {
    throw new AdminApiError(502, "INVALID_SERVER_RESPONSE", "server returned an invalid response");
  }
  return payload as T;
}

function validationDetail(error: AdminApiError) {
  const issue = error.issues[0];
  if (!issue) return "提交内容没有通过格式校验";
  const field = issue.path ? `字段 ${issue.path}` : "提交内容";
  return `${field}${issue.message ? `：${issue.message}` : "没有通过格式校验"}`;
}

export function describeAdminError(error: unknown, action = "操作") {
  if (!(error instanceof AdminApiError)) {
    return `[NETWORK_ERROR] ${action}失败：无法连接服务器，请检查网络后重试`;
  }

  const messages: Record<string, string> = {
    ACCESS_REJECTED: "服务器拒绝了当前请求",
    ADMIN_ALREADY_EXISTS: "这个管理员用户名已经存在",
    ADMIN_DELETE_SELF: "不能删除当前正在登录的账号",
    ADMIN_LOGIN_FAILED: "用户名或密码不正确",
    ADMIN_LOGIN_RATE_LIMITED: "登录失败次数过多，请十五分钟后再试",
    ADMIN_NOT_CONFIGURED: "初始超级管理员尚未配置",
    ADMIN_NOT_FOUND: "管理员账号不存在",
    ADMIN_PASSWORD_INVALID: "密码不能为空",
    ADMIN_USERNAME_INVALID: "管理员用户名格式不正确",
    AUTH_REQUIRED: "管理员登录已失效，请刷新页面并重新登录",
    BAD_REQUEST: "提交内容格式不正确",
    CONFLICT: "提交内容与服务器现有数据冲突",
    CROSS_ORIGIN_REJECTED: "安全地址校验失败，请使用当前服务器地址打开管理台",
    CSRF_REJECTED: "登录安全令牌已失效，请重新登录",
    EVENT_ALREADY_EXISTS: "这个活动编号已经存在",
    EVENT_ID_INVALID: "活动编号格式不正确",
    EVENT_NOT_FOUND: "活动不存在或已被移除",
    INTERNAL_ERROR: "服务器处理失败，请稍后重试",
    INVALID_JSON: "提交内容无法被服务器读取",
    INVALID_ORIGIN: "服务器无法确认当前管理台地址",
    INVALID_SERVER_RESPONSE: "服务器返回了无法识别的内容",
   MAINTENANCE_ACTIVE: "系统正在维护，请稍后再试",
    LOTTERY_NOT_FOUND: "抽奖项目不存在或已被删除",
    LOTTERY_PRIZE_NOT_FOUND: "奖品不存在或已被删除",
    LOTTERY_PRIZE_HAS_WINNERS: "这个奖品已有中奖记录，不能删除；可以把剩余库存改为已发数量并将概率设为 0%",
    LOTTERY_PRIZES_EMPTY: "请先添加至少一个奖品",
    LOTTERY_PROBABILITY_EXCEEDED: "所有奖品中奖概率合计不能超过 100%",
    LOTTERY_QUANTITY_BELOW_AWARDED: "奖品数量不能小于已经发出的数量",
    LOTTERY_REQUIREMENT_INVALID: "所选成就不属于当前活动",
    LOTTERY_REQUIREMENTS_EMPTY: "请先选择至少一个参与所需成就",
    NOT_FOUND: "请求的内容不存在",
    PAYLOAD_TOO_LARGE: "提交内容过大，请缩小内容后重试",
    RATE_LIMITED: "操作过于频繁，请稍后重试",
    REQUEST_FAILED: "请求没有成功",
    SERVER_ERROR: "服务器暂时无法完成请求",
    SUPERADMIN_PROTECTED: "不能删除受保护的超级管理员账号",
    SUPERADMIN_REQUIRED: "只有超级管理员可以执行这个操作",
    GITHUB_UPDATE_FAILED: "GitHub 没有接受更新请求，请检查令牌和工作流",
    GITHUB_UPDATE_NOT_CONFIGURED: "尚未配置 GitHub 更新功能",
  };
  const detail = error.code === "VALIDATION_FAILED"
    ? validationDetail(error)
    : messages[error.code] || error.message || "未知错误";
  return `[${error.code}] ${action}失败：${detail}`;
}

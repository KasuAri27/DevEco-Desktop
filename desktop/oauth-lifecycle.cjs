class SingleOAuthGate {
  constructor() {
    this.active = null;
    this.managementMutation = null;
  }

  reserve(flow) {
    if (this.managementMutation) throw new Error("Desktop 正在保存管理设置；请稍后再开始 Provider 授权");
    if (this.active) throw new Error("已有 Provider 授权流程正在运行；请先取消或完成后再开始另一个授权");
    this.active = flow;
    return flow;
  }

  isActive() {
    return this.active !== null;
  }

  assertUnlocked(action) {
    if (this.managementMutation) throw new Error(`Desktop 正在进行管理变更，暂不能${action}；请稍后重试`);
    if (this.active) throw new Error(`Provider 授权进行中，暂不能${action}；请先取消或完成授权`);
  }

  beginManagementMutation(action) {
    this.assertUnlocked(action);
    const lease = { action };
    this.managementMutation = lease;
    return lease;
  }

  endManagementMutation(lease) {
    if (this.managementMutation !== lease) return false;
    this.managementMutation = null;
    return true;
  }

  requestCancel(flow) {
    if (!flow || this.active !== flow) return false;
    flow.cancelRequested = true;
    flow.status = "cancelled";
    return true;
  }

  release(flow) {
    if (this.active !== flow) return false;
    this.active = null;
    return true;
  }
}

async function clearLateAuthorization(flow, cancelCore) {
  if (!flow?.cancelRequested) return false;
  await cancelCore();
  return true;
}

module.exports = { SingleOAuthGate, clearLateAuthorization };

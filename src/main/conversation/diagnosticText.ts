import { settingsService } from '../settings/settings-core/SettingsService';

/**
 * The person-facing text of conversation diagnostics, in the app's current language. Diagnostic codes,
 * provider ids and raw errors stay in the diagnostic's technical fields, which the UI keeps folded.
 */
const ZH = {
  routeMissing: '{agent} 还没有可用的模型。请在设置里为它选择模型。',
  providerUnavailable: '{agent} 选择的模型服务 {provider} 当前不可用。请检查这个服务的连接、账号或密钥后重试。',
  providerUnverified: '{agent} 选择的模型服务 {provider} 尚未验证。请先在设置里完成连接测试。',
  modelUnavailable: '{agent} 选择的模型 {model} 当前不可用。请在设置里刷新模型列表，或改选同一服务的其它模型。',
  modelNotExecutable: '{agent} 选择的模型 {model} 不能用于调查。',
  modelAlternatives: '{reason} 可以改选：{alternatives}。',
  profileOverrideFallback: '{scope}定义的智能体设置无效，已改用上一级的有效设置。{detail}',
  profileOverrideBlocked: '{scope}定义的智能体设置无效，且没有可以改用的上一级设置。{detail}',
  scopeUser: '用户',
  scopeProject: '项目',
  missionIncomplete: '本次调查尚未完成：缺少可核对的调查记录或最终报告。已有记录都保留着，请补齐材料或继续调查。',
  loopObligationIgnored: '{agent} 收到未完成的条件后既没有继续处理，也没有说明阻塞原因，已停止。已有结果都保留着，请补齐缺口后继续。',
  loopRepeated: '{agent} 连续三轮用相同的参数调用相同的工具并得到相同结果，已停止以免继续空转。请调整任务，或换一个具备所需工具的智能体。',
  loopTurnLimit: '{agent} 用完了 {turns} 轮的上限仍需要继续调用工具，已停止。请缩小任务范围，或在智能体设置里放宽轮次。',
  streamIntegrity: '{agent} 使用 {model} 时，应用在校验流式回复的完整性时出错。这是应用自身的问题，与账号、额度或网络无关；请把技术详情提供给开发者。',
  artifactQuota: '本地会话文件的配额已满，当前操作没有完成。原始会话和已写入的证据都保留着；清理多余的产物后继续。',
  artifactFailed: '本地上下文文件处理失败。原始会话和证据都保留着；解决本地文件的保存或读取问题后可以继续调查。',
  checkpointRecordFailed: '调查记录无法建立上下文检查点。原始会话和调查证据都保留着；解决记录读取问题后可以继续。',
  checkpointFailed: '上下文检查点没有建立。原始会话和调查证据都保留着；解决这个问题后可以继续调查。',
  taskUnsettled: '模型已经给出答复，但本轮还有没收尾的任务。应用已把它们标为受阻并保留证据；请查看任务状态，说明完成或受阻的原因后继续。',
  imageUnsupported: '{agent} 当前的模型不接受图片附件。请换一个支持图片输入的模型后重试。',
  attachmentRejected: '附件没能用于本次请求。请移除无效的附件后重试。',
  requestAuth: '{agent} 使用 {model} 时认证或权限失败。请检查账号的 API Key、登录状态或模型权限后重试。',
  requestQuota: '{agent} 使用 {model} 时额度不足或被限流。请检查账号额度、账单，或稍后重试。',
  requestOverloaded: '{agent} 使用 {model} 时服务繁忙或容量不足。请稍后重试；如果持续出现，可以换一个模型。',
  requestServer: '{agent} 使用 {model} 时服务端出错。请稍后重试。',
  requestEmpty: '{agent} 使用 {model} 时，服务没有返回答复或工具调用。请稍后重试；如果持续出现，请换一个模型。',
  requestNetwork: '{agent} 使用 {model} 时网络连接失败。请检查网络、代理或服务是否可以访问后重试。',
  requestRejected: '{agent} 使用 {model} 时，服务拒绝了本次请求的工具或参数格式。请换一个模型或稍后重试；如果持续出现，需要开发者修正这个模型的工具定义。',
  requestModelMissing: '{agent} 使用 {model} 时发现账号里没有这个模型，或它已下线。请在设置里换一个可用的模型。',
  requestFailed: '{agent} 使用 {model} 时请求没有成功。请检查账号、模型权限、额度或网络后重试。',
  turnFailed: '回复失败',
  turnWaitingModel: '等待模型配置',
  turnCompleted: '回复已完成',
  sessionStateSaveFailed: '会话状态保存失败',
} as const;

export type DiagnosticTextKey = keyof typeof ZH;

const EN: Record<DiagnosticTextKey, string> = {
  routeMissing: '{agent} has no model yet. Choose one for it in Settings.',
  providerUnavailable: 'The model service {provider} chosen for {agent} is unavailable. Check its connection, account or key, then try again.',
  providerUnverified: 'The model service {provider} chosen for {agent} is not verified yet. Test its connection in Settings first.',
  modelUnavailable: 'The model {model} chosen for {agent} is unavailable. Refresh the model list in Settings or choose another model from the same service.',
  modelNotExecutable: 'The model {model} chosen for {agent} cannot run investigations.',
  modelAlternatives: '{reason} You can choose: {alternatives}.',
  profileOverrideFallback: 'The {scope} agent settings are invalid; the next valid settings are used instead. {detail}',
  profileOverrideBlocked: 'The {scope} agent settings are invalid and there are no other settings to fall back to. {detail}',
  scopeUser: 'user',
  scopeProject: 'project',
  missionIncomplete: 'The investigation is not finished: a verifiable investigation record or final report is missing. Existing records are kept; add the missing material or continue investigating.',
  loopObligationIgnored: '{agent} stopped: after receiving an open condition it neither continued nor named what blocked it. Existing results are kept; close the gap and continue.',
  loopRepeated: '{agent} called the same tool with the same arguments and got the same result three times in a row, so it stopped. Adjust the task or switch to an agent with the tools it needs.',
  loopTurnLimit: '{agent} still needed tools after its {turns}-turn limit and stopped. Narrow the task or allow more turns in the agent settings.',
  streamIntegrity: '{agent} hit an integrity error in the app while checking the streamed reply from {model}. This is a problem in the app, not your account, quota or network; please share the technical details with the developers.',
  artifactQuota: 'The local session file quota is full, so this action did not finish. The original session and saved evidence are kept; remove redundant files and continue.',
  artifactFailed: 'Processing a local context file failed. The original session and evidence are kept; fix the local save or read problem and continue.',
  checkpointRecordFailed: 'The investigation record could not provide a context checkpoint. The original session and evidence are kept; fix the record read problem and continue.',
  checkpointFailed: 'The context checkpoint was not created. The original session and evidence are kept; fix the problem and continue.',
  taskUnsettled: 'The model answered while tasks in this turn were still open. They are marked blocked with their evidence kept; check the tasks, state why each is done or blocked, and continue.',
  imageUnsupported: 'The current model for {agent} does not accept images. Switch to a model with image input and try again.',
  attachmentRejected: 'An attachment could not be used for this request. Remove it and try again.',
  requestAuth: '{agent} could not authenticate with {model}. Check the API key, sign-in or model access, then try again.',
  requestQuota: '{agent} ran out of quota or was rate-limited on {model}. Check the account quota or billing, or try again later.',
  requestOverloaded: '{agent} found {model} busy or over capacity. Try again later; if it keeps happening, switch models.',
  requestServer: '{agent} got a server error from {model}. Try again later.',
  requestEmpty: '{agent} got neither a reply nor a tool call from {model}. Try again later; if it keeps happening, switch models.',
  requestNetwork: '{agent} could not reach {model}. Check the network, proxy or service availability, then try again.',
  requestRejected: '{agent} sent tools or arguments that {model} rejected. Switch models or try again later; if it keeps happening, the developers need to fix this model\'s tool definitions.',
  requestModelMissing: '{agent} found that {model} is not in the account or was retired. Choose an available model in Settings.',
  requestFailed: '{agent} could not complete the request to {model}. Check the account, model access, quota or network, then try again.',
  turnFailed: 'Reply failed',
  turnWaitingModel: 'Waiting for a model',
  turnCompleted: 'Reply complete',
  sessionStateSaveFailed: 'Saving the session state failed',
};

export function diagnosticText(key: DiagnosticTextKey, params: Record<string, string | number> = {}): string {
  const template = settingsService.snapshot().user.appearance.language === 'en' ? EN[key] : ZH[key];
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => (params[name] == null ? placeholder : String(params[name])));
}

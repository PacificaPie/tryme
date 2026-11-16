import {registerMessages} from './i18n.js';
export const creatorMessages={
  '讨论':'Discussion','我':'Me','访客':'Guest','作者':'Creator','取消回复':'Cancel reply','写评论':'Write a comment','说点什么…':'Say something…','公开评论':'Public comment','发布':'Post','发布中…':'Posting…','查看更多评论':'More comments','回复 {name}':'Replying to {name}','回复':'Reply','重试点赞 {name} 的评论':'Retry liking {name}’s comment','取消点赞 {name} 的评论':'Unlike {name}’s comment','点赞 {name} 的评论':'Like {name}’s comment','重试':'Retry','重新加载评论':'Reload comments','加载讨论…':'Loading discussion…','加载中…':'Loading…','展开更多回复':'More replies','还没有评论，来聊聊这件作品。':'No comments yet. Start the conversation.','暂时没有收到评论保存结果，请重试。':'The comment has not been confirmed. Please retry.','评论已发布':'Comment posted','暂时没有收到点赞结果。':'The like has not been confirmed.','点赞暂未确认，点击爱心重试。':'The like has not been confirmed. Tap the heart to retry.',
  '等待构建':'Queued','导入源码':'Importing source','安装依赖':'Installing dependencies','构建项目':'Building project','整理运行包':'Packaging','构建完成':'Build ready','构建失败':'Build failed','已取消':'Cancelled','本次操作未切换版本；线上后来已有变化':'This action made no change; the live version has since changed.','{version} 已是当前版本':'{version} is already live','已发布 {version}':'Published {version}','已切换到 {version}':'Switched to {version}','；线上版本后来已有变化':'; the live version has since changed.','正在导入…':'Importing…','构建中…':'Building…','读取文件':'Read file','导入并构建':'Import and build','正在读取 GitHub…':'Reading GitHub…','沿用 {version} 封面':'Use the {version} cover','基于 {version}':'Based on {version}','正在发布…':'Publishing…','确认上次发布结果':'Check previous publish','发布新版本':'Publish new version','游戏文件须使用 UTF-8 编码。':'The game file must use UTF-8 encoding.','新版本预览':'New version preview','关闭预览':'Close preview','重新登录':'Sign in again','版本历史':'Version history','更新 {name}':'Update {name}','新版本文件':'New version file','本地 HTML':'Local HTML','新版本 HTML 文件':'New version HTML file','GitHub 链接':'GitHub URL','构建进度':'Build progress','取消构建':'Cancel build','构建记录':'Build log','更新说明':'Release notes','封面':'Cover','替换封面':'Replace cover','沿用当前封面':'Keep current cover','线上版本已变化，你选择的文件和说明已保留。':'The live version changed. Your files and release notes are still here.','按当前版本继续':'Continue from the live version','更多':'More','预览试玩':'Play preview','保存草稿并返回':'Save draft and return','请选择不超过 1 MB 的 HTML 文件。':'Choose an HTML file up to 1 MB.','请选择不超过 2 MB 的 PNG、JPG 或 WebP 图片。':'Choose a PNG, JPG or WebP image up to 2 MB.','正在切换…':'Switching…','查看当前版本':'View live version','重试切换':'Retry switch','将普通作品链接切换到 {version}。':'The work link will now open {version}.','切换到 {version}':'Switch to {version}','返回':'Back','我的作品':'My works','更新版本':'Update version','当前线上':'Live now','查看更多':'Show more','当前':'Current','首次发布':'Initial release','试玩 {version}':'Play {version}','切换到此版本':'Switch to this version','上次切换的结果尚未确认。':'The previous switch has not been confirmed.','确认切换结果':'Check switch result','当前线上版本':'Live version','历史版本':'Historical version','只能更新自己的作品。':'You can only update your own works.','外链作品暂不支持版本更新。':'Version updates are not available for external links.'
};
Object.assign(creatorMessages,{
 '作品版本已变化，请刷新后重新选择':'The work version changed. Refresh and choose again.',
 '同一次操作的内容已变化，请使用新的提交标识':'This action has changed. Start a new submission.',
 '更新版本仅接受游戏、封面和更新说明':'A version update can only change the game, cover and release notes.',
 '版本不存在':'This version could not be found.',
 '该版本没有平台托管的游戏':'This version has no hosted game.',
 '目前仅支持站内游戏的版本更新':'Version updates are currently available for hosted games only.',
 '请提供有效的作品修订号':'Provide a valid work revision.',
 '每页须为 1–50 个版本':'Choose 1–50 versions per page.',
 '版本分页标识无效':'The version page token is invalid.',
 '构建任务标识无效':'The build ID is invalid.',
 '构建产物须发布为站内作品':'Build artifacts must be published as hosted works.',
 '构建产物和本地文件不能同时发布':'Choose a build artifact or a local file, not both.',
 '请选择 HTML 文件':'Choose an HTML file.',
 '封面须在 2 MiB 以内':'The cover must be no larger than 2 MiB.',
 '封面须为图片文件':'The cover must be an image file.',
 '构建任务不存在':'This build could not be found.',
 '同一次导入的仓库链接已变化':'The repository URL changed. Start a new import.',
 '构建器暂未在线，请稍后再试':'The builder is offline. Try again later.',
 '每次最多同时构建 2 个项目，每小时最多导入 10 次':'Up to 2 concurrent builds and 10 imports per hour.',
 '构建尚未成功，请等待构建完成':'Wait for the build to finish successfully.',
 '构建产物不存在，请重新导入':'The build artifact is missing. Import the project again.',
 '构建产物过大':'The build artifact is too large.',
 '构建产物校验失败，请重新导入':'The build artifact failed verification. Import it again.',
 '构建超时，请重新导入':'The build timed out. Import the project again.',
 '等待构建器超时，请重新导入':'Waiting for the builder timed out. Import the project again.',
 '服务暂不可用，请保留内容后重试':'The service is temporarily unavailable. Keep your content and try again.',
 '提交太频繁，请稍后重试':'Too many requests. Try again shortly.'
});
registerMessages(creatorMessages);

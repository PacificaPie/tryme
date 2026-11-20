import {t, registerMessages} from './i18n.js';

registerMessages({
  '创作工作台':'Creator workspace', '工作台导航':'Workspace navigation',
  '浏览 Feed':'Browse Feed', '公开个人主页':'Public profile',
  '访客看到的个人资料与公开作品':'Your profile and public works, as visitors see them',
  '管理作品':'Manage works', '发布、编辑与版本管理':'Publish, edit and manage versions',
  '管理名片':'Manage cards', '制作、更新与分享':'Create, update and share',
  '查看数据':'View analytics', '访问、试玩与趋势':'Visits, plays and trends',
  '互动反馈':'Feedback', '评论记录与历史反馈':'Comments and past feedback',
  '继续发布草稿':'Continue publishing draft', '继续草稿':'Continue draft',
  '上次填写的内容已保留，可以继续完成发布。':'Your saved progress is ready to continue.',
  '返回作品管理':'Back to works', '返回名片管理':'Back to cards',
  '编辑个人资料':'Edit profile',
});

// Only the signed-in management routes share this frame. Public profiles,
// Feed, other creators' cards and the legacy following route keep their views.
export function workspaceSection({path = '', params} = {}) {
  if (path === '/studio/data') return 'data';
  if (path === '/studio/feedback') return 'feedback';
  if (path === '/studio' || path === '/studio/works' || path.startsWith('/studio/works/') || path === '/publish' || path.startsWith('/published/')) return 'works';
  if ((path === '/cards' && params?.get('following') !== '1') || path.startsWith('/cards/me') || path.startsWith('/cards/templates/') || path.startsWith('/cards/covers/')) return 'cards';
  return null;
}

const sections = [
  ['works', '/studio/works', '管理作品', '发布、编辑与版本管理'],
  ['cards', '/cards', '管理名片', '制作、更新与分享'],
  ['data', '/studio/data', '查看数据', '访问、试玩与趋势'],
  ['feedback', '/studio/feedback?tab=history', '互动反馈', '评论记录与历史反馈'],
];

export function creatorWorkspace(content, {route, user} = {}) {
  const active = workspaceSection(route);
  if (!active || !user?.id) return content;
  return `<div class="page creator-workspace"><header class="creator-workspace-header"><p class="creator-workspace-title">${t('创作工作台')}</p><div class="creator-workspace-links"><a href="#/feed">← ${t('浏览 Feed')}</a><a href="#/author/${encodeURIComponent(user.id)}" title="${t('访客看到的个人资料与公开作品')}">${t('公开个人主页')} ↗</a><button type="button" data-edit-profile>${t('编辑个人资料')}</button></div></header><nav class="creator-workspace-nav" aria-label="${t('工作台导航')}">${sections.map(([id,href,label,description])=>`<a href="#${href}"${active===id?' class="active" aria-current="page"':''}><span>${t(label)}</span><small>${t(description)}</small></a>`).join('')}</nav><div class="creator-workspace-body">${content}</div></div>`;
}

export function publishResumeMarkup(draft = {}, file = null) {
  if (!file && !['name','desc','url','githubURL','html'].some(key => typeof draft[key] === 'string' && draft[key].trim())) return '';
  return `<aside class="workspace-resume"><div><strong>${t('继续发布草稿')}</strong><p>${t('上次填写的内容已保留，可以继续完成发布。')}</p></div><a class="button quiet" href="#/publish">${t('继续草稿')} →</a></aside>`;
}

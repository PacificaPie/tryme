// Product categories are independent of the upload/hosting source.
export const WORK_CATEGORIES = Object.freeze([
  {id:'website',label:'个人网站'},
  {id:'game',label:'游戏'},
  {id:'other',label:'其他'},
]);
export const isWorkCategory = value => WORK_CATEGORIES.some(category=>category.id===value);
export const workCategoryLabel = value => WORK_CATEGORIES.find(category=>category.id===value)?.label || '其他';

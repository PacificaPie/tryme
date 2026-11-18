import type { ReactNode } from "react";
export const metadata={title:"TryMe",icons:{icon:"/assets/tryme-icon.svg"},description:"发现可以玩的作品，认识创作者。"};
export default function RootLayout({children}:{children:ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>;}

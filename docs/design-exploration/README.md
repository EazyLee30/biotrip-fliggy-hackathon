# 设计探索存档

`original-assets/` 保存原 Stitch 截图、原始字体和框架示例图标，供设计对照与追溯。它们不再位于 `public/`，不会作为生产静态资源部署。

实际产品使用 `public/ambience/` 的明亮旅行氛围图和 `public/fonts/` 的 WOFF2 字体。氛围图是生成素材，不代表实际景点、酒店或商品；资产来源、说明和用途见 `src/lib/visual-assets.ts`。字体授权见 `public/fonts/LICENSE-jakarta.txt`。

2026-10-04 的 [资产登记](asset-register.json) 记录六组氛围图的十二个 WebP 文件、大小及 SHA-256，供后续替换核对。来源依据是仓库声明，原始生成回执尚未随派生文件归档；登记不是第三方照片授权证明。当前没有补充真实目的地照片。后续采用照片需分别保存作者、原始来源、许可范围和署名要求，不能沿用生成氛围图的来源声明。

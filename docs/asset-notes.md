# 帕姆 3D 立绘接入说明（task-3）

> 网页左侧「帕姆立绘栏」用 three.js 原生 API 渲染 `assets/model/source/PomPom.fbx`，并带待机动效、贴图映射、性能限制与静态海报降级。
> 官方 UI 参考：`refs/ui_main.png`；视觉 token 见 `docs/plan.md` §7.1（深夜蓝 `#0b1026` / 金色 `#d9b46a`）。

## 1. 交付物

| 文件 | 说明 |
| --- | --- |
| `src/components/pompom/PomPomStage.tsx` | React client component（默认导出），对外 props：`outfit?`（预留换装，仅透传 `data-outfit`）、`className?`、`onReady?`、`posterSrc?`、`modelUrl?`、`textureUrls?`、`ariaLabel?` |
| `src/components/pompom/pompomCore.js` | 与框架无关的 three.js 渲染核心（React 与独立预览页共用） |
| `public/model/PomPom.fbx` | 模型副本（2.7 MB，二进制 FBX 7.4） |
| `public/model/textures/body.png` | 源 `assets/model/textures/身体.png`（2048×2048 RGB，身体 atlas） |
| `public/model/textures/face.png` | 源 `assets/model/textures/表情.png`（1181×1181 RGBA，表情图集） |
| `public/model/pompom-poster.png` | 降级用静态海报（480×640，深蓝底） |
| `scripts/record-pompom.mjs` | 海报/验收截图的生成脚本（离线自建预览页 或 截 dev server 页面） |
| `docs/asset-preview.png` | 在 `pnpm dev` 的 `/preview` 页面截图（480×640，帕姆全身可见） |

主页左栏与 `/preview` 路由由 Lead 接入：`import PomPomStage from "@/components/pompom/PomPomStage"`。

## 2. 模型结构（实测解析 FBX 二进制）

- 版本：Kaydara FBX Binary 7.4（7400），Blender 2.93.4 FBX IO 导出；`UnitScaleFactor=100`、UpAxis=Y、坐标系在 `Armature` 节点上带 -90° X 旋转。
- 层级：`Armature`（Null）→ 2 个 Mesh：
  - `表情`：几何体 `帕姆3.0`，306 顶点 / 442 三角形，脸部表情覆盖层（贴 `表情.png`）。
  - `眼睛`：几何体 `帕姆3.001`，10423 顶点 / 14772 三角形，帕姆本体 + 帽子 + 制服 + 披风/尾巴（贴 `身体.png`）。
- 骨骼：217 根（Hips/Spine/Chest/Neck/Head、帽子 Yed_/Zed_ 链、手臂/手指、Bib 围裙、Wt/Ys 披风、Tail 尾巴、腿脚）。
  用 `FBXLoader` 加载后遍历得到 **434 个 Bone 对象**（2 个 Skin 各自持有一套骨骼，2×217；见 §7 已知问题）。
- Deformer：2 × `Skin`（434 个 Cluster）、2 × `BlendShape`、**53 个 BlendShapeChannel / 55 个 Shape 几何体**（`まばたき` 眨眼、`にこり`、`じと目`、`口角上げ` 等，日文命名）。
- 材质：2 个（`表情` / `眼睛`）；贴图引用 17 个（含内嵌 Video），实际使用 2 张 PNG（中文文件名 `PomPom.fbm\身体.png`、`PomPom.fbm\表情.png`）。
- 绑定姿势：A-pose（手臂自然下垂偏外，非 T-pose），无需程序化扳手臂；代码里保留「检测到接近水平（T-pose）才放下手臂」的保护逻辑（阈值 `|dy| < 0.55|dx|`，本模型不会触发）。

## 3. 动画信息 & 待机方案

**模型没有可用动画**：`Takes` 为空、无 `AnimationStack` / `AnimationLayer` / `AnimationCurve` → `FBXLoader` 返回 `animations.length === 0`。

因此待机全部程序化（`pompomCore.js` 的 `applyIdle`）：

1. 上下浮动：根节点 y ±0.012（周期 4.2s）；
2. 呼吸缩放：`scale.y` ±0.5%，`scale.x/z` 反向 ∓0.35%；
3. 轻微左右摇摆：`rotation.z` ±0.011 rad（周期 7.6s）；
4. 头部小幅摆动：`Head` 骨骼（名称经归一化查找，FBXLoader 会把 `Left arm` 变成 `Left_arm`）叠加 ±0.02 rad 的 Euler 微扰；
5. 眨眼：blendShape `まばたき`（1 个通道），首次眨眼延迟 2.2–4.2s，之后间隔 2.4–5.6s，22% 概率双眨眼；
6. `prefers-reduced-motion: reduce` 时关闭全部待机（只渲染静态帧）。

`AnimationMixer` 链路仍然保留：若以后换成带动画的 FBX，会自动播放第一个 `AnimationClip`（不再叠加程序化待机）。

**可扩展 API**：`createPomPomStage()` 返回的句柄带 `setMorph(nameOrRegExp, value)` / `getMorphNames()`，后续做聊天表情联动（开心/惊讶/眨眼）可直接驱动这 53 个通道；`getDebugInfo()` 返回尺寸/取景/blendShape 数量。

## 4. 纹理映射

三张贴图/路径问题（中文名 + 内嵌路径失效），双保险处理：

1. `LoadingManager.setURLModifier`（`resolveAssetUrl`）：
   - 含 `身体` / `body` → `encodeURI("/model/textures/body.png")`；
   - 含 `表情` / `face` → `encodeURI("/model/textures/face.png")`；
   - 其余 URL 原样返回。
2. 加载完成后按**材质名**兜底替换 FBX 内嵌贴图（`parseImages` 生成的 blob URL 不可靠）：
   - 材质/网格名含 `表情` → `face.png`，`transparent + alphaTest 0.35 + DoubleSide`（脸部覆盖层）；
   - 其余（`眼睛`，即本体材质）→ `body.png`。
3. 贴图设置：`colorSpace = SRGBColorSpace`、`anisotropy ≤ 4`、`ClampToEdgeWrapping`。

> 源文件名是中文，公开目录里统一存为英文小写 `body.png` / `face.png`，避免 URL 编码与部署环境的差异；源文件不改动（`assets/` 只读）。

## 5. 取景 / 相机 / 灯光

- 相机：`PerspectiveCamera(fov 30)`，自动取景。
- **精确包围盒**：`Box3.setFromObject` 用的是 bind-pose 几何包围盒（会把 A-pose 手臂/披风全算进去，取景偏大）；这里用 `SkinnedMesh.applyBoneTransform` 逐顶点蒙皮后算一次真实 AABB（~1 万顶点，加载时一次性 <10ms）。
- 归一化：模型高度缩放到 2.0 世界单位、脚底贴 `y=0`；水平居中。
- 取景规则：优先填满高度；容器足够宽时完整入镜，竖长栏（游戏内左栏比例）允许左右裁掉少量披风/帽檐——与游戏内立绘一致，头部/手臂始终在画面内。`ResizeObserver` 变化时重算。
- 灯光：`HemisphereLight`（深蓝环境）+ 暖金主光 + 冷蓝补光 + 金色轮廓光 + 青色辅助轮廓光；`ACESFilmicToneMapping`，`alpha:true` 透明背景，让页面夜色渐变透出。
- 脚下加了一张程序化 canvas 径向渐变阴影（无网络请求）。

## 6. 性能参数

| 项 | 值 |
| --- | --- |
| 像素比 | `min(devicePixelRatio, 1.5)` |
| WebGLRenderer | `antialias:true, alpha:true, powerPreference:"low-power"` |
| 帧率 | 上限 40fps（`requestAnimationFrame` 节流，30–45fps 区间） |
| 暂停 | `IntersectionObserver`（离屏）+ `visibilitychange`（切后台）自动停 rAF；`handle.pause()/resume()` |
| 尺寸 | `ResizeObserver` + `renderer.setSize(w,h,false)`（CSS 控制显示尺寸） |
| 阴影 | 关闭 shadowMap（0 实时阴影，仅贴图假阴影） |
| 裁剪 | 蒙皮网格 `frustumCulled=false`（绑定姿势包围盒不可靠，避免消失） |
| 释放 | 卸载时 dispose 全部 geometry / material / texture / renderer，移除事件与 observer；`webglcontextlost` → 降级 |

## 7. 优雅降级（海报 / 占位）

1. WebGL 创建失败、context lost、FBX 加载失败、无网格 → `onError` → 组件切到 `fallback`，显示 `public/model/pompom-poster.png`（`object-contain object-center` + 内边距，全身完整不裁切）。
2. 海报本身 404/加载失败 → `<img onError>` → 纯 CSS 占位（金色圆环 + 「帕姆」二字），**不会出现破图图标**。
3. 加载中：先显示海报 + 底部「帕姆立绘加载中 xx%」进度胶囊；3D 首帧完成后画布 500ms 淡入、海报淡出。
4. 组件始终有深蓝径向渐变底色，任何情况下都不会留白/黑块。

## 8. 海报生成 / 截图命令

```bash
# 1) 生成降级海报（离线模式：自建临时静态服务器 + 独立预览页，不需要 dev server）
node scripts/record-pompom.mjs
#   → public/model/pompom-poster.png（480×640）

# 2) 截 dev server 上的 /preview 路由（验收截图）
#   注意：Next.js dev 默认只信任 localhost origin，请用 localhost 而不是 127.0.0.1
node scripts/record-pompom.mjs \
  --url http://localhost:3100/preview \
  --out docs/asset-preview.png \
  --size 480x640

# 3) 可选参数
#   --url <url>     截取已运行的 dev/prod 页面（否则走离线预览页）
#   --size WxH      默认 480x640
#   --chrome <bin>  Chrome 可执行文件（默认 google-chrome / $CHROME_BIN）
#   --keep          保留 public/model/.preview/ 临时预览页，便于浏览器手动打开调试
#   --debug         打印 canvas 尺寸/相机/包围盒等调试信息
```

脚本实现要点（换模型重出图时可能需要了解）：

- 从 `node_modules/three` 拷贝 `three.module.js` + `three.core.js` + `FBXLoader.js` 及其相对依赖（fflate / NURBS 曲线）到 `public/model/.preview/vendor/`，用 importmap 指向，生成临时预览页，截图后自动清理（`--keep` 保留）。
- 用 **Chrome DevTools Protocol**（Node 内置 WebSocket）等页面里组件的 `data-status="ready"` 后再 `Page.captureScreenshot`。直接 `--screenshot --virtual-time-budget` 会在动态 import / FBX 加载完成前截图（截到「载入帕姆中…」），不要用。
- **无显示环境（CI/容器）WebGL 黑屏的坑**：Chrome 会走 ANGLE Vulkan-XCB 并报 `xcb_connect() failed` → `eglInitialize` 失败。脚本已强制：
  - 清空子进程的 `DISPLAY` / `WAYLAND_DISPLAY` / `XDG_SESSION_TYPE`；
  - 加 `--ozone-platform=headless --use-angle=swiftshader --enable-unsafe-swiftshader`（`--disable-gpu` 可保留）；
  - 否则 headless 下永远是海报降级（这本身也是降级链路的有效验证）。
- Chrome 临时 profile 放在 `os.tmpdir()`，等进程退出后再删（否则 `ENOTEMPTY`）。

重新出图流程：替换 `assets/model/source/PomPom.fbx` 与 `assets/model/textures/` → 同步到 `public/model/`（贴图英文命名，或改 `POMPOM_TEXTURE_URLS`）→ `node scripts/record-pompom.mjs` → 检查海报。

## 9. 验收截图

- `docs/asset-preview.png`：`next dev`（3100）/preview 路由、Chrome headless + SwiftShader 软件 WebGL 实拍，480×640，帕姆全身（帽子到脚）、眼睛睁开、贴图正确。
- `public/model/pompom-poster.png`：同一渲染核心的离线截图，用于降级。
- 主页截图（Lead 负责）：`docs/screens/home.png` 左栏可看到同一模型（headless 无 WebGL 时走海报降级也完整显示全身）。

## 10. 已知问题 / TODO

1. **双骨架**：FBX 有 2 个 Skin，`FBXLoader` 会生成 434 个 Bone（2×217）；目前按名称取第一套做头部摆动，若某一侧的 mesh 使用另一套骨骼，头部微动可能只影响部分网格（幅度很小，肉眼看不出）。若以后要精确驱动表情/骨骼，需按 `SkinnedMesh.skeleton` 分别处理。
2. **无模型动画**：待机/眨眼全部程序化；若换到带动画的 FBX，代码会自动改播 `AnimationClip`，但程序化待机不会叠加（避免相互打架）。
3. **表情联动未接 UI**：`setMorph/getMorphNames` 已就绪，聊天语气 → 表情（开心/惊讶/害羞）可后续接入；当前脸部只有眨眼通道被驱动。
4. **贴图体积**：身体 atlas 2048² PNG（930 KB）+ face（119 KB）+ FBX 2.7 MB ≈ 3.7 MB 首屏资源；可考虑 WebP/KTX2 压缩（TODO，需改脚本与 `TextureLoader`）。
5. **`outfit` 换装 prop 仅预留**：`data-outfit` 透传，未做材质/骨骼换装。
6. **移动端**：<900px 左栏折叠由 Lead 的布局处理；组件本身只按容器尺寸自适应（已用 ResizeObserver + 自适应取景）。
7. 截图为软件渲染（SwiftShader），真实 GPU 下抗锯齿/各向异性会更细腻；色调可能略有差异。


---

## 12. 3渲2（cel-shading）改造记录（2026-11-17）

> 目标：原版立绘是明亮动漫风；旧实现是写实 PBR + 深色背景，与复刻后的亮色左栏不匹配。

### 12.1 渲染改动（`pompomCore.js` 的 `TOON_LOOK` / 材质构建）

- **材质**：`MeshToonMaterial` + 3 阶 `gradientMap`（`DataTexture`，`NearestFilter`、无 mipmap）：`[0.46, 0.74, 1.0]`，暗部/中间调/亮部色带分明；`bodyColor = 1.08` 轻微提亮。
- **描边**：反向外扩 hull（复制 mesh、`BackSide`、屏幕等宽描边 `outlineWidthPx = 2.3`，深藏青 `#1a1633`，通过 ShaderMaterial 按画布高度换算 NDC，DPR 无关）。
- **光照**：无 toneMapping、sRGB 输出；暖主光 + 冷色环境光 + 轻微 rim；强度按 toon 漫反射（环境/π + 色阶/π）调到 1.3~2 量级。
- **透明背景**：`renderer.setClearColor(0x000000, 0)`，叠在页面浅蓝白窗光上。
- **构图**：`bottomMargin = 0.09`、`maxWidthFraction = 1.32`、`maxHeightFraction = 0.9`；480×640 / 520×760 / 左栏≈450×790 都能全身可见、居中偏下、底部留给按钮。
- 待机动画保留：浮动/呼吸/Head 微摆/blendShape「まばたき」眨眼（`prefers-reduced-motion` 时冻结，用于截图）。

### 12.2 海报与预览重新生成

`/preview` 支持 `?bg=dark|light|transparent&w=&h=`（`src/app/preview/page.tsx`）。海报=透明底，预览=浅色底：

```bash
# 需要 headless WebGL（否则会走海报降级，反而截到旧海报）
node -e '
const { chromium } = require("playwright-core");
const env = { ...process.env }; delete env.DISPLAY;
(async () => {
  const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true, env,
    args: ["--no-sandbox","--ozone-platform=headless","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 900, height: 900 } });
  await p.goto("http://127.0.0.1:3000/preview?bg=transparent&w=520&h=760", { waitUntil: "networkidle" });
  await p.waitForFunction(() => document.querySelector("[data-status]")?.getAttribute("data-status") === "ready", { timeout: 45000 });
  await p.waitForTimeout(2500);
  await (await p.$("#pompom-preview")).screenshot({ path: "public/model/pompom-poster.png", omitBackground: true });
  await p.goto("http://127.0.0.1:3000/preview?bg=light&w=520&h=760", { waitUntil: "networkidle" });
  await p.waitForTimeout(2800);
  await (await p.$("#pompom-preview")).screenshot({ path: "docs/asset-preview.png" });
  await b.close();
})();
'
```

### 12.3 已知问题 / TODO

- 模型绑定姿势是 A-pose，`poseArmsDown()` 只在手臂接近水平时生效，当前保持 A-pose；如需改成原版站姿需要按骨骼名手动调手臂角度（手臂/肘/腕），有变形风险。
- 描边为屏幕等宽，极细处（贴图发丝处）可能有锯齿；可在更高 DPR 下观察。
- 表情/换装（outfit）仍未接入，`PomPomStage` 已留 `outfit`/`setMorph` 接口。

/**
 * pompomCore.js — 与框架无关的 three.js 渲染核心。
 *
 * 被 `PomPomStage.tsx`（React client component）调用；同时被
 * `scripts/record-pompom.mjs` 生成的独立预览页复用（见 docs/asset-notes.md）。
 *
 * 风格：**动漫 3渲2（cel-shading）** —— MeshToonMaterial + 3 阶 gradientMap
 * （明暗色阶分明、无写实高光）、反向外扩描边（inverted hull，深藏青 #1a1633）、
 * 暖主光 + 冷环境/rim 的明亮打光、渲染器透明背景，可叠在浅蓝白窗光上。
 *
 * 职责：
 *  1. three.js 原生 API 加载 FBX（FBXLoader），不依赖 @react-three/fiber；
 *  2. 用 LoadingManager.setURLModifier 把 FBX 里失效的中文贴图路径映射到
 *     public/model/textures/ 下的英文文件名（body.png / face.png），
 *     并按材质名兜底替换 FBX 内嵌贴图；
 *  3. 程序化待机：上下浮动 + 呼吸缩放 + 轻微摇摆 + 头部小幅摆动 + 眨眼
 *     （blendShape「まばたき」；若模型自带 AnimationClip 则优先播放动画）；
 *  4. 性能：像素比 ≤ 1.5、low-power、~40fps 节流、离屏/不可见时暂停、
 *     卸载时释放全部 GPU 资源；描边与本体共用 geometry / skeleton，
 *     不额外复制顶点、不每帧重建；
 *  5. 失败时通过 onError 通知调用方降级到静态海报（海报同样是 3渲2 亮色/透明底）。
 */

export const POMPOM_MODEL_URL = "/model/PomPom.fbx";

/** public/model/textures/ 下的英文贴图名（源文件名是中文：身体.png / 表情.png）。 */
export const POMPOM_TEXTURE_URLS = Object.freeze({
  body: "/model/textures/body.png", // 源 assets/model/textures/身体.png（2048² body atlas）
  face: "/model/textures/face.png", // 源 assets/model/textures/表情.png（1181² RGBA 表情图集）
});

const TARGET_FPS = 40;
const MAX_PIXEL_RATIO = 1.5;
const TARGET_MODEL_HEIGHT = 2.0; // 归一化后的模型世界高度，取景稳定
const CAMERA_FOV = 30;

/**
 * 3渲2 外观参数（明亮动漫风，透明背景叠在浅蓝白窗光上）。
 * 颜色 / 光强都按「无 toneMapping、sRGB 输出」直接调校：
 * MeshToonMaterial 的漫反射 ≈ (环境光/π + Σ 色阶/π) × 贴图，故强度普遍在 1.3~2 量级。
 */
const TOON_LOOK = Object.freeze({
  /** 3 阶色阶：暗部 / 中间调 / 亮部（DataTexture 最近邻采样，色带分明） */
  gradientSteps: Object.freeze([0.46, 0.74, 1.0]),
  /** 线性空间整体提亮系数：>1 让亮部更通透（贴图本身已是动画配色，不宜过度） */
  bodyColor: 1.08,
  /** 描边色 #1a1633（深藏青）。着色器直接输出 sRGB 分量，故这里存 0..1 原始值。 */
  outlineColor: Object.freeze([0x1a / 255, 0x16 / 255, 0x33 / 255]),
  /** 屏幕等宽描边：CSS 像素（DPR 无关，按画布高度换算成 NDC） */
  outlineWidthPx: 2.3,
  /** 脚底留白占画面高度的比例（构图：居中偏下） */
  bottomMargin: 0.09,
  /** 全身入镜：模型最多占画面宽 / 高的比例，不裁帽子与披风 */
  maxWidthFraction: 1.32,
  maxHeightFraction: 0.9,
});

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

/**
 * @typedef {object} PomPomStageOptions
 * @property {HTMLElement} container 画布挂载点
 * @property {string} [modelUrl]
 * @property {{body?: string, face?: string}} [textureUrls]
 * @property {() => void} [onReady] 首帧渲染完成（此时 canvas 已有可见内容）
 * @property {(error: Error) => void} [onError] WebGL 不可用 / 模型加载失败
 * @property {(progress: number) => void} [onProgress] 0..1
 * @property {boolean} [reducedMotion] prefers-reduced-motion 时禁掉待机动画
 */

/**
 * @typedef {object} PomPomStageHandle
 * @property {() => void} dispose
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => void} resize
 * @property {boolean} ready
 * @property {Error|null} error
 */

/**
 * 创建帕姆 3D 立绘舞台。同步返回句柄；异步加载失败时调用 onError。
 * @param {PomPomStageOptions} options
 * @returns {PomPomStageHandle}
 */
export function createPomPomStage(options) {
  const {
    container,
    modelUrl = POMPOM_MODEL_URL,
    textureUrls = POMPOM_TEXTURE_URLS,
    onReady,
    onError,
    onProgress,
    reducedMotion = false,
  } = options || {};

  const handle = {
    dispose,
    pause: () => {
      manualPaused = true;
      updateRunning();
    },
    resume: () => {
      manualPaused = false;
      updateRunning();
    },
    resize: () => resize(),
    /** 调试/后续表情联动：按名称（或正则）设置 blendShape 权重 0..1，返回命中的通道数。 */
    setMorph: (namePattern, value = 1) => {
      const regex = namePattern instanceof RegExp ? namePattern : new RegExp(namePattern);
      let count = 0;
      model?.traverse?.((object) => {
        if (!object || !object.isMesh || !object.morphTargetDictionary) return;
        for (const [channelName, index] of Object.entries(object.morphTargetDictionary)) {
          if (regex.test(channelName)) {
            if (object.morphTargetInfluences) object.morphTargetInfluences[index] = value;
            count += 1;
          }
        }
      });
      return count;
    },
    /** 调试：返回取景/尺寸等内部状态。 */
    getDebugInfo: () => ({
      modelHeight,
      modelWidth,
      basePivotY,
      modelBottomY,
      cameraAspect: camera ? Number(camera.aspect.toFixed(4)) : null,
      cameraZ: camera ? Number(camera.position.z.toFixed(3)) : null,
      cameraLookY: camera ? Number(camera.position.y.toFixed(3)) : null,
      canvas: renderer?.domElement
        ? [renderer.domElement.clientWidth, renderer.domElement.clientHeight]
        : null,
      blinkChannels: blinkTargets.length,
      armsPosedDown,
      hasAnimation: !!(mixer && mixer._actions && mixer._actions.length),
      toon: {
        gradientSteps: TOON_LOOK.gradientSteps.length,
        outlineMeshes: outlineCount,
        outlineWidthPx: TOON_LOOK.outlineWidthPx,
        toneMapping: renderer ? renderer.toneMapping : null,
      },
    }),
    /** 调试：列出模型全部 blendShape 通道名。 */
    getMorphNames: () => {
      const names = [];
      model?.traverse?.((object) => {
        if (!object || !object.isMesh || !object.morphTargetDictionary) return;
        names.push(...Object.keys(object.morphTargetDictionary));
      });
      return names;
    },
    get ready() {
      return ready;
    },
    get error() {
      return stageError;
    },
  };

  if (!container || !isBrowser) {
    fail(new Error("pompom: 无可用容器（非浏览器环境）"));
    return handle;
  }

  // ---- 内部状态 -----------------------------------------------------------
  let disposed = false;
  let ready = false;
  let readyNotified = false;
  let stageError = null;
  let manualPaused = false;
  let inView = true;
  let pageVisible = true;
  let running = false;
  let rafId = 0;

  let three = null;
  let renderer = null;
  let scene = null;
  let camera = null;
  let pivot = null; // 承担浮动/呼吸的根节点
  let model = null;
  let mixer = null;
  let loadManager = null;

  let resizeObserver = null;
  let intersectionObserver = null;
  let shadowTexture = null;
  let shadowMesh = null;
  let toonGradient = null; // 3 阶梯度贴图（所有 toon 材质共用）
  let outlineMaterial = null; // 描边 ShaderMaterial（反向外扩 hull）
  let outlineCount = 0;

  /** @type {Map<string, any>} */
  const textures = new Map();
  /** @type {Array<{mesh: any, index: number}>} */
  let blinkTargets = [];
  let headBone = null; // { bone, base: Quaternion }
  let modelHeight = TARGET_MODEL_HEIGHT;
  let modelWidth = TARGET_MODEL_HEIGHT * 0.62;
  let basePivotY = TARGET_MODEL_HEIGHT * 0.5;
  let modelBottomY = 0; // 归一化 + 摆姿势后的世界坐标脚底 y（用于构图对齐）

  let armsPosedDown = 0;
  let lastRenderAt = 0;
  let startedAt = 0;
  let nextBlinkAt = 0;
  let blinkStartedAt = -1;
  let blinkDouble = false;
  const idleQuat = { value: null };
  const idleEuler = { value: null };
  const idleVec = { value: null };

  // ---- 生命周期 -----------------------------------------------------------
  function fail(error) {
    if (disposed) return;
    stageError = error instanceof Error ? error : new Error(String(error));
    // eslint-disable-next-line no-console
    console.warn("[PomPomStage] 3D 立绘不可用，降级为静态海报：", stageError.message);
    try {
      onError?.(stageError);
    } catch (_) {
      /* onError 异常不能影响降级 */
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    stopLoop();
    try {
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      renderer?.domElement?.removeEventListener("webglcontextlost", onContextLost);
    } catch (_) {
      /* noop */
    }
    resizeObserver = null;
    intersectionObserver = null;

    try {
      if (scene) {
        scene.traverse((obj) => {
          if (!obj || !obj.isMesh) return;
          // 描边网格与本体共用 geometry，避免重复 dispose
          if (obj.userData?.isOutline) {
            obj.material?.dispose?.();
            return;
          }
          obj.geometry?.dispose?.();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if (!mat) continue;
            for (const value of Object.values(mat)) {
              if (value && value.isTexture) value.dispose?.();
            }
            mat.dispose?.();
          }
        });
      }
      toonGradient?.dispose?.();
      outlineMaterial?.dispose?.();
    } catch (_) {
      /* noop */
    }
    try {
      shadowTexture?.dispose();
      mixer?.stopAllAction?.();
      mixer = null;
      renderer?.dispose?.();
      if (renderer?.domElement?.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    } catch (_) {
      /* noop */
    }
    renderer = null;
    scene = null;
    camera = null;
    model = null;
    pivot = null;
    three = null;
    textures.clear();
    blinkTargets = [];
    headBone = null;
    toonGradient = null;
    outlineMaterial = null;
    outlineCount = 0;
    shadowMesh = null;
    idleQuat.value = null;
    idleEuler.value = null;
    idleVec.value = null;
  }

  // ---- 可见性 / 帧循环 ----------------------------------------------------
  function onVisibilityChange() {
    pageVisible = document.visibilityState !== "hidden";
    updateRunning();
  }

  function onContextLost(event) {
    event.preventDefault?.();
    fail(new Error("WebGL context lost"));
  }

  function updateRunning() {
    const shouldRun = !disposed && ready && !manualPaused && inView && pageVisible;
    if (shouldRun && !running) {
      running = true;
      startedAt = performance.now();
      lastRenderAt = 0;
      rafId = requestAnimationFrame(loop);
    } else if (!shouldRun && running) {
      stopLoop();
    }
  }

  function stopLoop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function loop(now) {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (lastRenderAt && now - lastRenderAt < 1000 / TARGET_FPS - 1.5) return;
    const dt = lastRenderAt ? Math.min(0.12, (now - lastRenderAt) / 1000) : 1 / TARGET_FPS;
    lastRenderAt = now;
    renderFrame(now, true, dt);
  }

  function renderFrame(now, animate, dt) {
    if (!renderer || !scene || !camera || disposed) return;
    if (animate && !reducedMotion) applyIdle(now, dt || 0);
    if (animate && mixer) {
      try {
        mixer.update(dt || 0);
      } catch (_) {
        /* 模型动画异常不影响静态展示 */
      }
    }
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      if (!readyNotified) {
        readyNotified = true;
        try {
          onReady?.();
        } catch (_) {
          /* noop */
        }
      }
    }
  }

  // ---- 程序化待机 ---------------------------------------------------------
  function applyIdle(now, dt) {
    if (!pivot || !three) return;
    const t = ((now - startedAt) / 1000) % 7200; // 防长时间运行浮点精度下降
    const breathe = Math.sin((t * Math.PI * 2) / 4.2);
    pivot.position.y = basePivotY + breathe * 0.012;
    pivot.rotation.z = Math.sin((t * Math.PI * 2) / 7.6) * 0.011;
    pivot.scale.set(1 - breathe * 0.0035, 1 + breathe * 0.005, 1 - breathe * 0.0035);

    if (headBone) {
      if (!idleEuler.value) idleEuler.value = new three.Euler();
      if (!idleQuat.value) idleQuat.value = new three.Quaternion();
      idleEuler.value.set(Math.sin(t * 0.72) * 0.014, Math.sin(t * 0.53 + 1.1) * 0.02, 0, "XYZ");
      idleQuat.value.setFromEuler(idleEuler.value);
      headBone.bone.quaternion.copy(headBone.base).multiply(idleQuat.value);
    }

    applyBlink(t);
  }

  function applyBlink(t) {
    if (!blinkTargets.length) return;
    if (blinkStartedAt < 0) {
      if (nextBlinkAt === 0) nextBlinkAt = t + 2.2 + Math.random() * 2.0;
      if (t >= nextBlinkAt) {
        blinkStartedAt = t;
        blinkDouble = Math.random() < 0.22;
      } else {
        return;
      }
    }
    const elapsed = t - blinkStartedAt;
    const single = 0.15;
    const gap = 0.07;
    let influence = 0;
    if (elapsed < single) {
      influence = Math.sin((elapsed / single) * Math.PI);
    } else if (blinkDouble && elapsed < single * 2 + gap) {
      const second = (elapsed - single - gap) / single;
      if (second > 0) influence = Math.sin(second * Math.PI);
    } else {
      blinkStartedAt = -1;
      nextBlinkAt = t + 2.4 + Math.random() * 3.2;
    }
    for (const target of blinkTargets) {
      const influences = target.mesh.morphTargetInfluences;
      if (influences) influences[target.index] = influence;
    }
  }

  // ---- 尺寸 / 取景 --------------------------------------------------------
  function resize() {
    if (!renderer || !camera || disposed) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(container.clientWidth || rect.width || 320));
    const height = Math.max(1, Math.round(container.clientHeight || rect.height || 480));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    frameCamera();
    // 描边宽度以 CSS 像素定义：NDC 偏移 = 2 * 像素 / CSS 高度（DPR 自动抵消）
    if (outlineMaterial) {
      outlineMaterial.uniforms.uAspect.value = camera.aspect || 1;
      outlineMaterial.uniforms.uOutlineWidth.value = (TOON_LOOK.outlineWidthPx * 2) / height;
    }
    if (ready) renderFrame(performance.now(), false, 0);
  }

  function frameCamera() {
    if (!camera) return;
    const aspect = camera.aspect || 1;
    const tan = Math.tan((camera.fov * Math.PI) / 180 / 2);
    // 全身完整入镜（帽子/披风不裁）：宽、高分别限制，取更远的相机距离
    const heightDist = modelHeight / (2 * tan * TOON_LOOK.maxHeightFraction);
    const widthDist = modelWidth / (2 * tan * aspect * TOON_LOOK.maxWidthFraction);
    const dist = Math.max(heightDist, widthDist);
    const halfFrame = tan * dist;
    // 脚底对齐到画面底部 8%：lookAt 点抬高 → 模型居中偏下，顶部留窗光
    const lookY = modelBottomY + (1 - TOON_LOOK.bottomMargin * 2) * halfFrame;
    camera.position.set(0, lookY, dist);
    camera.lookAt(0, lookY, 0);
    camera.near = Math.max(0.05, dist * 0.02);
    camera.far = dist * 8;
    camera.updateProjectionMatrix();
  }

  // ---- 资源加载 -----------------------------------------------------------
  function resolveAssetUrl(rawUrl) {
    let decoded = rawUrl;
    try {
      decoded = decodeURIComponent(rawUrl);
    } catch (_) {
      /* 保持原样 */
    }
    const clean = decoded.split(/[?#]/)[0];
    const base = clean.split(/[\\/]/).pop() || clean;
    if (decoded.includes("身体") || /^body\.png$/i.test(base) || /(^|[^a-z])body\.png$/i.test(base)) {
      return encodeURI(textureUrls.body || POMPOM_TEXTURE_URLS.body);
    }
    if (decoded.includes("表情") || /^face\.png$/i.test(base) || /(^|[^a-z])face\.png$/i.test(base)) {
      return encodeURI(textureUrls.face || POMPOM_TEXTURE_URLS.face);
    }
    return rawUrl;
  }

  function loadTexture(THREE, url) {
    return new Promise((resolve) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        encodeURI(url),
        (texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() ?? 1);
          texture.wrapS = THREE.ClampToEdgeWrapping;
          texture.wrapT = THREE.ClampToEdgeWrapping;
          texture.needsUpdate = true;
          resolve(texture);
        },
        undefined,
        (error) => {
          // 贴图缺失不致命：用材质颜色兜底，几何体仍然完整可见
          // eslint-disable-next-line no-console
          console.warn(`[PomPomStage] 贴图加载失败：${url}`, error);
          resolve(null);
        },
      );
    });
  }

  async function init() {
    const THREE = await import("three");
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
    three = THREE;
    if (disposed) return;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 50);

    // 3渲2 明亮打光（无 toneMapping，光强直接决定 3 阶色阶亮度）：
    //   ambient 1.35 → 基础亮度 ≈0.43；key 1.9 → 亮部再 +0.60；
    //   冷色环境/rim 让暗部带蓝紫倾向，整体通透、不出现“金属暗部”。
    scene.add(new THREE.AmbientLight(0xcfe0ff, 1.35)); // 冷色环境光：抬亮暗部
    const keyLight = new THREE.DirectionalLight(0xfff4de, 1.9); // 暖主光（右上前方）
    keyLight.position.set(2.2, 3.6, 3.8);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xa9c4ff, 0.55); // 冷色补光（左侧）
    fillLight.position.set(-3.4, 1.2, 2.4);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xbfe0ff, 1.35); // 冷色轮廓光（后左上）
    rimLight.position.set(-1.8, 2.4, -3.6);
    scene.add(rimLight);
    const rimWarm = new THREE.DirectionalLight(0xffe6c2, 0.45); // 暖色辅助轮廓（后右）
    rimWarm.position.set(2.2, 1.0, -2.6);
    scene.add(rimWarm);

    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        stencil: false,
        powerPreference: "low-power",
      });
    } catch (error) {
      throw new Error("WebGL 不可用：" + (error && error.message ? error.message : String(error)));
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 3渲2：不压高光、保留鲜艳的动画配色（ACES 会把亮部压灰、降低饱和度）
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0); // 透明背景：让页面浅蓝白窗光透出来
    renderer.shadowMap.enabled = false;

    // 3 阶色阶贴图 + 描边材质（全场景共用，只创建一次）
    toonGradient = createToonGradientMap(THREE);
    outlineMaterial = createOutlineMaterial(THREE);

    const canvas = renderer.domElement;
    canvas.style.cssText = "display:block;width:100%;height:100%;outline:none;";
    canvas.setAttribute("aria-hidden", "true");
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    container.appendChild(canvas);
    if (disposed) {
      renderer.dispose();
      return;
    }

    // 脚底柔和投影（程序化 canvas 纹理，不发网络请求；冷蓝灰、很淡，不写实）
    shadowTexture = createShadowTexture(THREE);
    if (shadowTexture) {
      shadowMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.5, depthWrite: false }),
      );
      shadowMesh.rotation.x = -Math.PI / 2;
      shadowMesh.position.y = 0.004;
      shadowMesh.renderOrder = -1;
      scene.add(shadowMesh);
    }

    // 贴图与 FBX 并行加载；setURLModifier 负责中文路径 → 英文文件名
    const textureJob = Promise.all([
      loadTexture(THREE, textureUrls.body || POMPOM_TEXTURE_URLS.body).then((t) => ["body", t]),
      loadTexture(THREE, textureUrls.face || POMPOM_TEXTURE_URLS.face).then((t) => ["face", t]),
    ]);
    const modelJob = new Promise((resolve, reject) => {
      loadManager = new THREE.LoadingManager();
      loadManager.setURLModifier(resolveAssetUrl);
      const fbxLoader = new FBXLoader(loadManager);
      fbxLoader.load(
        encodeURI(modelUrl),
        (fbx) => resolve(fbx),
        (event) => {
          if (onProgress && event && event.total) onProgress(Math.min(1, event.loaded / event.total));
        },
        (error) => reject(error instanceof Error ? error : new Error("FBX 加载失败")),
      );
    });

    const [textureEntries, fbx] = await Promise.all([textureJob, modelJob]);
    if (disposed) {
      for (const [, texture] of textureEntries) texture?.dispose?.();
      return;
    }
    for (const [key, texture] of textureEntries) {
      if (texture) textures.set(key, texture);
    }
    onProgress?.(1);

    model = fbx;
    scene.add(fbx);
    prepareModel(THREE, fbx);
    buildObservers();
    resize();
    renderFrame(performance.now(), false, 0);
    updateRunning();
  }

  function createShadowTexture(THREE) {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // 冷蓝灰软阴影：亮色背景下只是“地面接触光斑”，不追求写实投影
    gradient.addColorStop(0, "rgba(55,70,132,0.42)");
    gradient.addColorStop(0.55, "rgba(55,70,132,0.16)");
    gradient.addColorStop(1, "rgba(55,70,132,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  // ---- 3渲2 外观：色阶贴图 / toon 材质 / 描边 ---------------------------

  /** 3 阶 gradientMap（最近邻、无 mipmap，色带分明；所有 toon 材质共用一张）。 */
  function createToonGradientMap(THREE) {
    const steps = TOON_LOOK.gradientSteps;
    const data = new Uint8Array(steps.length * 4);
    for (let i = 0; i < steps.length; i += 1) {
      const value = Math.round(THREE.MathUtils.clamp(steps[i], 0, 1) * 255);
      data[i * 4] = value;
      data[i * 4 + 1] = value;
      data[i * 4 + 2] = value;
      data[i * 4 + 3] = 255;
    }
    const gradientMap = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
    gradientMap.name = "PomPomToonGradient3";
    gradientMap.minFilter = THREE.NearestFilter;
    gradientMap.magFilter = THREE.NearestFilter;
    gradientMap.generateMipmaps = false;
    gradientMap.wrapS = THREE.ClampToEdgeWrapping;
    gradientMap.wrapT = THREE.ClampToEdgeWrapping;
    gradientMap.colorSpace = THREE.NoColorSpace; // 色阶是线性倍率，不做 sRGB 解码
    gradientMap.needsUpdate = true;
    return gradientMap;
  }

  /** 本体：MeshToonMaterial（3 阶色阶 + 贴图，略微提亮）。 */
  function createBodyToonMaterial(THREE, bodyTexture) {
    const material = new THREE.MeshToonMaterial({
      map: bodyTexture || null,
      gradientMap: toonGradient,
    });
    material.name = "PomPomBodyToon";
    if (bodyTexture) {
      material.color.setRGB(TOON_LOOK.bodyColor, TOON_LOOK.bodyColor, TOON_LOOK.bodyColor);
    } else {
      material.color.setHex(0xd8d2c6); // 贴图缺失兜底：亮米色，仍能看清轮廓
    }
    material.fog = false;
    return material;
  }

  /**
   * 表情：贴纸式叠加层，用 unlit（MeshBasicMaterial）保持原图颜色。
   * 它贴在已经 toon 化的脸前，若再参与光照会把黑色眼线/腮红压暗或拉出横向色带。
   */
  function createFaceOverlayMaterial(THREE, faceTexture) {
    const material = new THREE.MeshBasicMaterial({
      map: faceTexture || null,
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.35,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    material.name = "PomPomFaceOverlay";
    if (!faceTexture) {
      material.color.setHex(0x1a1633);
      material.opacity = 0.001; // 无贴图时不要留黑色色块
    }
    return material;
  }

  /**
   * 描边材质：inverted hull（BackSide）+ 视空间法线等宽外扩。
   * 顶点着色器手动做 skinning / morph 变换，保证蒙皮网格的描边跟随骨骼与眨眼；
   * uOutlineWidth = 2 * CSS 像素 / 画布 CSS 高度，因此任何尺寸下描边视觉宽度一致。
   */
  function createOutlineMaterial(THREE) {
    const vertexShader = /* glsl */ `
      attribute vec3 outlineNormal;

      #include <common>
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>

      uniform float uOutlineWidth;
      uniform float uAspect;

      void main() {
        vec3 objectNormal = outlineNormal;

        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>

        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinning_vertex>
        #include <project_vertex>

        // 视图空间法线 → 裁剪空间方向；再换回「像素等比」方向后按 NDC 偏移。
        // 乘以 gl_Position.w，保证透视除法后每个顶点都偏同样的像素数。
        vec2 ndcNormal = ( projectionMatrix * vec4( normalize( transformedNormal ), 0.0 ) ).xy;
        vec2 dir = normalize( vec2( ndcNormal.x * uAspect, ndcNormal.y ) + vec2( 1e-6 ) );
        gl_Position.xy += vec2( dir.x / uAspect, dir.y ) * ( uOutlineWidth * gl_Position.w );
      }
    `;
    const fragmentShader = /* glsl */ `
      uniform vec3 uOutlineColor;
      void main() {
        gl_FragColor = vec4( uOutlineColor, 1.0 );
      }
    `;
    return new THREE.ShaderMaterial({
      name: "PomPomOutline",
      uniforms: {
        uOutlineWidth: { value: (TOON_LOOK.outlineWidthPx * 2) / 640 },
        uAspect: { value: 0.75 },
        // 直接给 sRGB 分量（ShaderMaterial 不会自动做输出色彩空间转换）
        uOutlineColor: { value: new THREE.Vector3(...TOON_LOOK.outlineColor) },
      },
      vertexShader,
      fragmentShader,
      side: THREE.BackSide,
      transparent: false,
      depthWrite: true,
      toneMapped: false,
    });
  }

  /**
   * 给几何体烘焙一份「按位置平滑」的法线属性 outlineNormal。
   * 反向外扩描边若直接用 split normal，UV 硬边处会裂开；按位置合并法线后描边均匀。
   * 属性直接挂在共享 geometry 上（不复制顶点），只有描边 shader 会用到。
   */
  function attachSmoothOutlineNormals(THREE, geometry) {
    if (!geometry || geometry.getAttribute("outlineNormal")) return true;
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    if (!position || !normal) return false;
    const vertexCount = position.count;
    const smooth = new Float32Array(vertexCount * 3);
    /** @type {Map<string, {x:number,y:number,z:number}>} */
    const sums = new Map();
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    const keyOf = (vertex) =>
      `${Math.round(vertex.x * 1e4)},${Math.round(vertex.y * 1e4)},${Math.round(vertex.z * 1e4)}`;

    for (let i = 0; i < vertexCount; i += 1) {
      p.fromBufferAttribute(position, i);
      n.fromBufferAttribute(normal, i);
      const key = keyOf(p);
      const sum = sums.get(key);
      if (sum) {
        sum.x += n.x;
        sum.y += n.y;
        sum.z += n.z;
      } else {
        sums.set(key, { x: n.x, y: n.y, z: n.z });
      }
    }
    for (const sum of sums.values()) {
      const length = Math.hypot(sum.x, sum.y, sum.z) || 1;
      sum.x /= length;
      sum.y /= length;
      sum.z /= length;
    }
    for (let i = 0; i < vertexCount; i += 1) {
      p.fromBufferAttribute(position, i);
      const sum = sums.get(keyOf(p));
      const i3 = i * 3;
      if (sum) {
        smooth[i3] = sum.x;
        smooth[i3 + 1] = sum.y;
        smooth[i3 + 2] = sum.z;
      } else {
        n.fromBufferAttribute(normal, i);
        smooth[i3] = n.x;
        smooth[i3 + 1] = n.y;
        smooth[i3 + 2] = n.z;
      }
    }
    geometry.setAttribute("outlineNormal", new THREE.BufferAttribute(smooth, 3));
    return true;
  }

  function buildObservers() {
    try {
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => resize());
        resizeObserver.observe(container);
      }
    } catch (_) {
      /* noop */
    }
    try {
      if (typeof IntersectionObserver !== "undefined") {
        intersectionObserver = new IntersectionObserver(
          (entries) => {
            inView = entries[0] ? entries[0].isIntersecting : true;
            updateRunning();
          },
          { threshold: 0.01 },
        );
        intersectionObserver.observe(container);
      }
    } catch (_) {
      /* noop */
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    pageVisible = document.visibilityState !== "hidden";
  }

  // ---- 模型后处理 ---------------------------------------------------------
  /** FBXLoader 会把骨骼名里的空格转成下划线（"Left arm" -> "Left_arm"），按归一化名查找。 */
  function findBone(root, canonicalName) {
    const target = canonicalName.replace(/\s+/g, "_");
    let found = null;
    root.traverse((object) => {
      if (found || !object.isBone) return;
      if (object.name.replace(/\s+/g, "_") === target) found = object;
    });
    return found;
  }
  function prepareModel(THREE, fbx) {
    fbx.updateMatrixWorld(true);

    // 1) 贴图 + 3渲2 材质：本体换 MeshToonMaterial（3 阶色阶），表情换 unlit 贴纸层
    const bodyTexture = textures.get("body") || null;
    const faceTexture = textures.get("face") || null;
    let meshCount = 0;
    fbx.traverse((object) => {
      if (!object || !object.isMesh) return;
      meshCount += 1;
      object.frustumCulled = false; // 蒙皮网格包围盒不可靠，避免被误裁剪
      const oldMaterials = Array.isArray(object.material) ? object.material : [object.material];
      const isFaceMesh = /表情/.test(object.name || "");
      disposeMaterialTree(object.material); // FBX 自带 PBR 材质/内嵌贴图不再使用
      const nextMaterials = oldMaterials.map((oldMaterial) => {
        const materialName = `${oldMaterial?.name || ""} ${object.name || ""}`;
        const isFaceMaterial = /表情|face/i.test(materialName) || isFaceMesh;
        return isFaceMaterial
          ? createFaceOverlayMaterial(THREE, faceTexture)
          : createBodyToonMaterial(THREE, bodyTexture);
      });
      object.material = Array.isArray(object.material) ? nextMaterials : nextMaterials[0];
    });
    if (meshCount === 0) throw new Error("FBX 中未找到可渲染网格");

    // 2) 绑定姿势若是 T-pose，把手臂自然放下（A-pose 保持原样；只做一次，不参与每帧）
    poseArmsDown(THREE, fbx);

    // 3) 归一化尺寸 + 居中，适配任意 FBX 单位（本模型 UnitScaleFactor=100）
    // 注意：Box3.setFromObject 用的是 bind-pose 的 geometry.boundingBox，
    // 若绑定姿势是 T-pose 而我们把手臂放下了，包围盒会偏宽导致取景过远。
    // 这里按蒙皮后的真实顶点位置算一次精确包围盒（~1 万顶点，毫秒级）。
    const bounds = computePosedBounds(THREE, fbx);
    if (!Number.isFinite(bounds.min.x) || bounds.isEmpty()) throw new Error("模型包围盒为空");
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const rawHeight = Math.max(size.y || 0.001, 0.001);
    const rawWidth = Math.max(size.x || 0.001, 0.001);
    const scale = TARGET_MODEL_HEIGHT / rawHeight;
    modelHeight = TARGET_MODEL_HEIGHT;
    modelWidth = rawWidth * scale;

    pivot = new THREE.Group();
    pivot.name = "PomPomPivot";
    basePivotY = TARGET_MODEL_HEIGHT * 0.5 + 0.015; // 脚底贴近 y=0 的投影面
    pivot.position.y = basePivotY;
    scene.add(pivot);
    fbx.scale.setScalar(scale);
    fbx.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    pivot.add(fbx);
    modelBottomY = (bounds.min.y - center.y) * scale + basePivotY;

    // 3.5) 3渲2 描边：反向外扩 hull，与本体共用 geometry / skeleton / morph influences
    buildOutline(THREE, fbx);

    if (shadowMesh) {
      shadowMesh.scale.set(Math.max(0.5, modelWidth * 0.62), Math.max(0.34, modelWidth * 0.34), 1);
    }

    // 4) 头部骨骼轻微摆动的基准
    const head = findBone(fbx, "Head");
    if (head) headBone = { bone: head, base: head.quaternion.clone() };

    // 5) 眨眼：模型无 AnimationClip，靠 shape key「まばたき」
    if (!(fbx.animations && fbx.animations.length)) {
      let shapeCount = 0;
      fbx.traverse((object) => {
        if (!object || !object.isMesh || object.userData?.isOutline || !object.morphTargetDictionary) return;
        for (const [channelName, index] of Object.entries(object.morphTargetDictionary)) {
          shapeCount += 1;
          if (/まばたき|blink/i.test(channelName)) {
            blinkTargets.push({ mesh: object, index });
            if (object.morphTargetInfluences) object.morphTargetInfluences[index] = 0;
          }
        }
      });
      // eslint-disable-next-line no-console
      console.info(
        `[PomPomStage] 模型 AnimationClip=0，使用程序化待机；BlendShape 通道 ${shapeCount} 个，眨眼通道 ${blinkTargets.length} 个`,
      );
    }
  }

  /** 释放被替换掉的旧材质及其贴图（FBX 内嵌贴图是 blob，避免内存泄漏）。 */
  function disposeMaterialTree(material) {
    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      if (!mat) continue;
      for (const value of Object.values(mat)) {
        if (value && value.isTexture) value.dispose?.();
      }
      mat.dispose?.();
    }
  }

  /**
   * 3渲2 描边：为除表情贴纸外的每个网格克隆一个 inverted-hull 网格（BackSide）。
   * 克隆与本体共用 geometry / skeleton / morph influences，不复制顶点、不每帧重建；
   * 顶点着色器里按平滑法线做屏幕等宽外扩（见 createOutlineMaterial）。
   */
  function buildOutline(THREE, fbx) {
    if (!outlineMaterial) return;
    const targets = [];
    fbx.traverse((object) => {
      if (!object || !object.isMesh || object.userData?.isOutline) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const isFaceOverlay = materials.some((mat) => mat && /FaceOverlay/.test(mat.name || ""));
      if (!isFaceOverlay) targets.push(object);
    });
    for (const mesh of targets) {
      if (!attachSmoothOutlineNormals(THREE, mesh.geometry)) continue;
      const outline = mesh.clone();
      if (!outline) continue;
      outline.name = `${mesh.name || "PomPomMesh"}_outline`;
      outline.userData.isOutline = true;
      outline.material = outlineMaterial;
      outline.frustumCulled = false;
      outline.castShadow = false;
      outline.receiveShadow = false;
      // 与本体共享 morph influences：眨眼/表情变化时描边同步形变
      outline.morphTargetInfluences = mesh.morphTargetInfluences;
      outline.morphTargetDictionary = mesh.morphTargetDictionary;
      mesh.parent?.add(outline);
      outlineCount += 1;
    }
    // eslint-disable-next-line no-console
    console.info(
      `[PomPomStage] 3渲2：本体 MeshToonMaterial（${TOON_LOOK.gradientSteps.length} 阶色阶）+ 描边 ${outlineCount} 个（反向外扩 ${TOON_LOOK.outlineWidthPx}px）`,
    );
  }

  /** 按当前骨骼姿势计算真实 AABB（逐顶点蒙皮，仅加载时一次）。 */
  function computePosedBounds(THREE, fbx) {
    fbx.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const vertex = new THREE.Vector3();
    fbx.traverse((object) => {
      if (!object || !object.isMesh || object.userData?.isOutline) return;
      const position = object.geometry?.attributes?.position;
      if (!position) return;
      const step = Math.max(1, Math.floor(position.count / 6000)); // 最多采样 6000 点/网格
      for (let i = 0; i < position.count; i += step) {
        vertex.fromBufferAttribute(position, i);
        if (object.isSkinnedMesh && object.applyBoneTransform) {
          object.applyBoneTransform(i, vertex);
          vertex.applyMatrix4(object.matrixWorld);
        } else {
          vertex.applyMatrix4(object.matrixWorld);
        }
        box.expandByPoint(vertex);
      }
    });
    return box;
  }

  /**
   * Blender 导出的绑定姿势常见为 T-pose / A-pose。检测左右手臂是否接近水平，
   * 是则绕世界 Z 轴放下手臂并给手肘一点自然弯曲。
   */
  function poseArmsDown(THREE, fbx) {
    const pairs = [
      { upper: "Left arm", elbow: "Left elbow", wrist: "Left wrist", sign: 1 },
      { upper: "Right arm", elbow: "Right elbow", wrist: "Right wrist", sign: -1 },
    ];
    const shoulderPos = new THREE.Vector3();
    const wristPos = new THREE.Vector3();
    let posed = 0;
    for (const pair of pairs) {
      const upper = findBone(fbx, pair.upper);
      const wrist = findBone(fbx, pair.wrist) || findBone(fbx, pair.elbow);
      if (!upper || !wrist) continue;
      upper.getWorldPosition(shoulderPos);
      wrist.getWorldPosition(wristPos);
      const vx = wristPos.x - shoulderPos.x;
      const vy = wristPos.y - shoulderPos.y;
      // 手臂接近水平（|dx| 明显大于 |dy|）→ 认为还没放下
      if (Math.abs(vx) < 1e-6 || Math.abs(vy) > Math.abs(vx) * 0.55) continue;
      const currentAngle = Math.atan2(vy, vx);
      const targetAngle = Math.atan2(-1, pair.sign * 0.28);
      let delta = targetAngle - currentAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      const axis = new THREE.Vector3(0, 0, 1);
      upper.rotateOnWorldAxis(axis, delta);
      const elbow = findBone(fbx, pair.elbow);
      if (elbow) elbow.rotateOnWorldAxis(axis, pair.sign * 0.16);
      fbx.updateMatrixWorld(true);
      posed += 1;
    }
    armsPosedDown = posed;
    if (posed) {
      // eslint-disable-next-line no-console
      console.info(`[PomPomStage] 检测到绑定姿势手臂水平，已程序化放下 ${posed} 侧手臂`);
    }
  }

  // ---- 启动 ---------------------------------------------------------------
  init().catch((error) => fail(error));
  return handle;
}

export default createPomPomStage;

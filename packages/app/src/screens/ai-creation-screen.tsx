import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import {
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileText,
  FileType,
  ImagePlus,
  Image as ImageIcon,
  Mic,
  Paperclip,
  PanelLeft,
  Palette,
  Presentation,
  Redo2,
  SquarePen,
  Sparkles,
  Table2,
  Undo2,
  WandSparkles,
  X,
  type LucideIcon,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type ImageSourcePropType,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type PressableStateCallbackType,
  type TextInputContentSizeChangeEventData,
} from "react-native";
import Svg, { Path } from "react-native-svg";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import type { DaemonClient } from "@getdoya/client/internal/daemon-client";
import type { AgentProvider } from "@getdoya/protocol/agent-types";
import type { AgentAttachment } from "@getdoya/protocol/messages";
import { saveAccountBootstrapSession, type AccountBootstrapSession } from "@/account/account-api";
import { createAccountProject } from "@/account/account-project-api";
import { applyAccountProjectDisplay } from "@/account/account-workspace-display";
import { useAccountWorkspaceMetadata } from "@/account/use-account-workspace-metadata";
import {
  encodeAttachmentsForSend,
  persistAttachmentFromBlob,
  persistAttachmentFromDataUrl,
  persistAttachmentFromFileUri,
} from "@/attachments/service";
import { blobToBase64 } from "@/attachments/utils";
import type {
  AttachmentMetadata,
  ComposerAttachment,
  UserComposerAttachment,
} from "@/attachments/types";
import {
  materializeWorkspaceAttachmentsToFiles,
  materializeWorkspaceFileAttachments,
  materializeWorkspaceImageAttachmentsForSubmit,
  workspaceMaterializedFilesToPromptAttachments,
  workspaceMaterializedFilesToUserMessageImages,
  type WorkspaceMaterializeAttachment,
} from "@/attachments/workspace-materialize";
import { useAttachmentPreviewUrl } from "@/attachments/use-attachment-preview-url";
import { pickAndPersistImages } from "@/composer/actions";
import { splitComposerAttachmentsForSubmit } from "@/composer/attachments/submit";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  HEADER_HORIZONTAL_PADDING,
  HEADER_INNER_HEIGHT,
  useIsCompactFormFactor,
} from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import {
  allocateControlSessionWorkDir,
  appendControlSessionMessage,
  createControlSession,
  ensureControlUserDaemonWorkspace,
  isControlApiConfigured,
  selectControlRuntimeNode,
  upsertControlAgentBinding,
  type ControlSchedulerDaemonNodeRecord,
} from "@/control/control-api";
import { buildControlAgentLabels } from "@/control/control-agent-labels";
import { resolveControlRuntimeDirectEndpoint } from "@/control/control-runtime-endpoint";
import { notifyControlSessionsChanged } from "@/control/control-session-events";
import { useToast } from "@/contexts/toast-context";
import {
  getHostRuntimeStore,
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHosts,
} from "@/runtime/host-runtime";
import { translateNow, useI18n, type Locale } from "@/i18n/i18n";
import { translate } from "@/i18n/translate";
import type { TranslationKey } from "@/i18n/translations";
import { usePanelStore } from "@/stores/panel-store";
import { useBillingUpgradeModalStore } from "@/stores/billing-upgrade-modal-store";
import { buildWorkspaceDraftAgentConfig } from "@/screens/workspace/workspace-draft-agent-config";
import {
  clearAiCreationEditSource,
  takeAiCreationEditSource,
} from "@/stores/ai-creation-edit-source-store";
import { saveAiCreationMessageDisplayMetadata } from "@/stores/ai-creation-message-display-store";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  normalizeWorkspaceDescriptor,
  useSessionStore,
  type WorkspaceDescriptor,
} from "@/stores/session-store";
import { useRecommendedProjectPaths, useWorkspaceFields } from "@/stores/session-store-hooks";
import { buildAiCreationTitle } from "@/utils/ai-creation-display";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { normalizeHostPort } from "@/utils/daemon-endpoints";
import { encodeImages } from "@/utils/encode-images";
import {
  buildDoyaMessageMeta,
  buildDoyaResponseLanguageInstruction,
  escapeDoyaMarkupText,
} from "@/utils/doya-message-markup";
import { getBillingUpgradeReason } from "@/utils/billing-errors";
import { buildHostAgentDetailRoute, buildHostHomeRoute } from "@/utils/host-routes";
import { useAccountLoginModalStore } from "@/stores/account-login-modal-store";
import { useImageAttachmentPicker } from "@/hooks/use-image-attachment-picker";
import { useFileAttachmentPicker } from "@/hooks/use-file-attachment-picker";
import type { PickedImageAttachmentInput } from "@/hooks/image-attachment-picker";
import { useWindowControlsPadding } from "@/utils/desktop-window";
import { ConversationReplayDraftControls } from "@/replay/conversation-replay-composer-controls";
import {
  buildOptimisticUserMessage,
  generateMessageId,
  type UserMessageImageAttachment,
} from "@/types/stream";

type CreationMode = "image" | "slides" | "pdf" | "word" | "spreadsheet" | "edit";
type CreationSurfaceMode = Exclude<CreationMode, "edit">;
type AiCreationIntent =
  | "imagegen"
  | "image_edit"
  | "ppt_creation"
  | "pdf_creation"
  | "word_creation"
  | "spreadsheet_creation";
type AspectRatio = "1:1" | "2:3" | "3:4" | "4:3" | "9:16" | "16:9";
type VisualStyle =
  | "auto"
  | "portrait"
  | "cinematic"
  | "chinese"
  | "anime"
  | "render3d"
  | "cyberpunk"
  | "cgAnimation"
  | "ink"
  | "oil"
  | "classic"
  | "watercolor"
  | "cartoon"
  | "flatIllustration"
  | "landscape"
  | "hongKongAnime"
  | "pixel"
  | "neon"
  | "coloredPencil"
  | "figurine"
  | "kidsDrawing"
  | "abstract"
  | "sharpIllustration"
  | "acg"
  | "inkPrint"
  | "printmaking"
  | "monet"
  | "picasso"
  | "rembrandt"
  | "matisse"
  | "baroque"
  | "retroAnime"
  | "pictureBook";

interface SelectionPoint {
  x: number;
  y: number;
}

interface SelectionStroke {
  points: SelectionPoint[];
  width: number;
  color: string;
}

interface CanvasLayout {
  width: number;
  height: number;
}

interface CanvasBounds extends CanvasLayout {
  x: number;
  y: number;
}

interface ImageDimensions {
  width: number;
  height: number;
}

interface InitialAiCreationEditState {
  mode: CreationMode;
  references: PreviewableAttachmentMetadata[];
  previewUri: string | null;
  imageSource: string | null;
  sourceAgentId: string | null;
  sourceServerId: string | null;
}

type PreviewableAttachmentMetadata = AttachmentMetadata & {
  fallbackPreviewUrl?: string | null;
};

interface EncodedAiCreationImages {
  images?: Array<{ data: string; mimeType: string; fileName?: string }>;
  hasSelectionGuide: boolean;
  selectionGuide: WorkspaceMaterializeAttachment | null;
}

interface AiCreationWorkspace {
  cwd: string;
  workspaceId: string;
  client: DaemonClient;
  controlSessionId?: string;
  runtimeId?: string;
  nodeId?: string;
  userWorkspaceId?: string;
}

interface AiCreationAgentConfig {
  provider: AgentProvider;
  modeId?: string;
  model?: string;
  thinkingOptionId?: string;
  featureValues?: Record<string, unknown>;
}

interface CreateAiCreationWorkspaceInput {
  accountSession: AccountBootstrapSession | null;
  client: DaemonClient | null;
  agentConfig: AiCreationAgentConfig;
  displayName: string;
  initialPrompt: string;
  mergeWorkspaces: (serverId: string, workspaces: Iterable<WorkspaceDescriptor>) => void;
  hosts: ReturnType<typeof useHosts>;
  serverId: string;
  setHasHydratedWorkspaces: (serverId: string, hydrated: boolean) => void;
}

const RATIO_OPTIONS: AspectRatio[] = ["1:1", "2:3", "3:4", "4:3", "9:16", "16:9"];
const SLIDE_RATIO_OPTIONS: AspectRatio[] = ["16:9", "4:3"];
const MASK_VIEWBOX_SIZE = 1000;
const EDIT_CANVAS_MAX_IMAGE_WIDTH = 760;
const EDIT_CANVAS_STAGE_HORIZONTAL_PADDING = 32;
const SELECTION_DEFAULT_STROKE_COLOR = "#20744A";
const SELECTION_STROKE_COLORS = [
  "#20744A",
  "#EF4444",
  "#F59E0B",
  "#3B82F6",
  "#A855F7",
  "#FFFFFF",
  "#111827",
] as const;
const SELECTION_BRUSH_SIZE_MIN = 18;
const SELECTION_BRUSH_SIZE_MAX = 110;
const SELECTION_BRUSH_SIZE_DEFAULT = 58;

const RATIO_LABEL_KEYS: Record<AspectRatio, TranslationKey> = {
  "1:1": "aiCreation.ratio.1_1",
  "2:3": "aiCreation.ratio.2_3",
  "3:4": "aiCreation.ratio.3_4",
  "4:3": "aiCreation.ratio.4_3",
  "9:16": "aiCreation.ratio.9_16",
  "16:9": "aiCreation.ratio.16_9",
};

const STYLE_LABEL_KEYS: Record<VisualStyle, TranslationKey> = {
  auto: "aiCreation.style.auto",
  portrait: "aiCreation.style.portrait",
  cinematic: "aiCreation.style.cinematic",
  chinese: "aiCreation.style.chinese",
  anime: "aiCreation.style.anime",
  render3d: "aiCreation.style.render3d",
  cyberpunk: "aiCreation.style.cyberpunk",
  cgAnimation: "aiCreation.style.cgAnimation",
  ink: "aiCreation.style.ink",
  oil: "aiCreation.style.oil",
  classic: "aiCreation.style.classic",
  watercolor: "aiCreation.style.watercolor",
  cartoon: "aiCreation.style.cartoon",
  flatIllustration: "aiCreation.style.flatIllustration",
  landscape: "aiCreation.style.landscape",
  hongKongAnime: "aiCreation.style.hongKongAnime",
  pixel: "aiCreation.style.pixel",
  neon: "aiCreation.style.neon",
  coloredPencil: "aiCreation.style.coloredPencil",
  figurine: "aiCreation.style.figurine",
  kidsDrawing: "aiCreation.style.kidsDrawing",
  abstract: "aiCreation.style.abstract",
  sharpIllustration: "aiCreation.style.sharpIllustration",
  acg: "aiCreation.style.acg",
  inkPrint: "aiCreation.style.inkPrint",
  printmaking: "aiCreation.style.printmaking",
  monet: "aiCreation.style.monet",
  picasso: "aiCreation.style.picasso",
  rembrandt: "aiCreation.style.rembrandt",
  matisse: "aiCreation.style.matisse",
  baroque: "aiCreation.style.baroque",
  retroAnime: "aiCreation.style.retroAnime",
  pictureBook: "aiCreation.style.pictureBook",
};

const STYLE_PROMPT_LABELS: Record<VisualStyle, string> = {
  auto: "auto",
  portrait: "portrait photography",
  cinematic: "cinematic photography",
  chinese: "Chinese style",
  anime: "anime",
  render3d: "3D render",
  cyberpunk: "cyberpunk",
  cgAnimation: "CG animation",
  ink: "ink wash painting",
  oil: "oil painting",
  classic: "classical",
  watercolor: "watercolor painting",
  cartoon: "cartoon",
  flatIllustration: "flat illustration",
  landscape: "landscape",
  hongKongAnime: "Hong Kong anime",
  pixel: "pixel art",
  neon: "neon painting",
  coloredPencil: "colored pencil drawing",
  figurine: "collectible figurine",
  kidsDrawing: "children's drawing",
  abstract: "abstract",
  sharpIllustration: "sharp pen illustration",
  acg: "ACG",
  inkPrint: "ink print",
  printmaking: "printmaking",
  monet: "Monet",
  picasso: "Picasso",
  rembrandt: "Rembrandt",
  matisse: "Matisse",
  baroque: "Baroque",
  retroAnime: "retro anime",
  pictureBook: "picture book",
};

const STYLE_OPTIONS: readonly VisualStyleOption[] = [
  { value: "auto", key: STYLE_LABEL_KEYS.auto },
  {
    value: "portrait",
    key: STYLE_LABEL_KEYS.portrait,
    source: require("../../assets/ai-creation-style-thumbnails/portrait.webp"),
  },
  {
    value: "cinematic",
    key: STYLE_LABEL_KEYS.cinematic,
    source: require("../../assets/ai-creation-style-thumbnails/cinematic.webp"),
  },
  {
    value: "chinese",
    key: STYLE_LABEL_KEYS.chinese,
    source: require("../../assets/ai-creation-style-thumbnails/chinese.webp"),
  },
  {
    value: "anime",
    key: STYLE_LABEL_KEYS.anime,
    source: require("../../assets/ai-creation-style-thumbnails/anime.webp"),
  },
  {
    value: "render3d",
    key: STYLE_LABEL_KEYS.render3d,
    source: require("../../assets/ai-creation-style-thumbnails/render3d.webp"),
  },
  {
    value: "cyberpunk",
    key: STYLE_LABEL_KEYS.cyberpunk,
    source: require("../../assets/ai-creation-style-thumbnails/cyberpunk.webp"),
  },
  {
    value: "cgAnimation",
    key: STYLE_LABEL_KEYS.cgAnimation,
    source: require("../../assets/ai-creation-style-thumbnails/cg-animation.webp"),
  },
  {
    value: "ink",
    key: STYLE_LABEL_KEYS.ink,
    source: require("../../assets/ai-creation-style-thumbnails/ink.webp"),
  },
  {
    value: "oil",
    key: STYLE_LABEL_KEYS.oil,
    source: require("../../assets/ai-creation-style-thumbnails/oil.webp"),
  },
  {
    value: "classic",
    key: STYLE_LABEL_KEYS.classic,
    source: require("../../assets/ai-creation-style-thumbnails/classic.webp"),
  },
  {
    value: "watercolor",
    key: STYLE_LABEL_KEYS.watercolor,
    source: require("../../assets/ai-creation-style-thumbnails/watercolor.webp"),
  },
  {
    value: "cartoon",
    key: STYLE_LABEL_KEYS.cartoon,
    source: require("../../assets/ai-creation-style-thumbnails/cartoon.webp"),
  },
  {
    value: "flatIllustration",
    key: STYLE_LABEL_KEYS.flatIllustration,
    source: require("../../assets/ai-creation-style-thumbnails/flat-illustration.webp"),
  },
  {
    value: "landscape",
    key: STYLE_LABEL_KEYS.landscape,
    source: require("../../assets/ai-creation-style-thumbnails/landscape.webp"),
  },
  {
    value: "hongKongAnime",
    key: STYLE_LABEL_KEYS.hongKongAnime,
    source: require("../../assets/ai-creation-style-thumbnails/hong-kong-anime.webp"),
  },
  {
    value: "pixel",
    key: STYLE_LABEL_KEYS.pixel,
    source: require("../../assets/ai-creation-style-thumbnails/pixel.webp"),
  },
  {
    value: "neon",
    key: STYLE_LABEL_KEYS.neon,
    source: require("../../assets/ai-creation-style-thumbnails/neon.webp"),
  },
  {
    value: "coloredPencil",
    key: STYLE_LABEL_KEYS.coloredPencil,
    source: require("../../assets/ai-creation-style-thumbnails/colored-pencil.webp"),
  },
  {
    value: "figurine",
    key: STYLE_LABEL_KEYS.figurine,
    source: require("../../assets/ai-creation-style-thumbnails/figurine.webp"),
  },
  {
    value: "kidsDrawing",
    key: STYLE_LABEL_KEYS.kidsDrawing,
    source: require("../../assets/ai-creation-style-thumbnails/kids-drawing.webp"),
  },
  {
    value: "abstract",
    key: STYLE_LABEL_KEYS.abstract,
    source: require("../../assets/ai-creation-style-thumbnails/abstract.webp"),
  },
  {
    value: "sharpIllustration",
    key: STYLE_LABEL_KEYS.sharpIllustration,
    source: require("../../assets/ai-creation-style-thumbnails/sharp-illustration.webp"),
  },
  {
    value: "acg",
    key: STYLE_LABEL_KEYS.acg,
    source: require("../../assets/ai-creation-style-thumbnails/acg.webp"),
  },
  {
    value: "inkPrint",
    key: STYLE_LABEL_KEYS.inkPrint,
    source: require("../../assets/ai-creation-style-thumbnails/ink-print.webp"),
  },
  {
    value: "printmaking",
    key: STYLE_LABEL_KEYS.printmaking,
    source: require("../../assets/ai-creation-style-thumbnails/printmaking.webp"),
  },
  {
    value: "monet",
    key: STYLE_LABEL_KEYS.monet,
    source: require("../../assets/ai-creation-style-thumbnails/monet.webp"),
  },
  {
    value: "picasso",
    key: STYLE_LABEL_KEYS.picasso,
    source: require("../../assets/ai-creation-style-thumbnails/picasso.webp"),
  },
  {
    value: "rembrandt",
    key: STYLE_LABEL_KEYS.rembrandt,
    source: require("../../assets/ai-creation-style-thumbnails/rembrandt.webp"),
  },
  {
    value: "matisse",
    key: STYLE_LABEL_KEYS.matisse,
    source: require("../../assets/ai-creation-style-thumbnails/matisse.webp"),
  },
  {
    value: "baroque",
    key: STYLE_LABEL_KEYS.baroque,
    source: require("../../assets/ai-creation-style-thumbnails/baroque.webp"),
  },
  {
    value: "retroAnime",
    key: STYLE_LABEL_KEYS.retroAnime,
    source: require("../../assets/ai-creation-style-thumbnails/retro-anime.webp"),
  },
  {
    value: "pictureBook",
    key: STYLE_LABEL_KEYS.pictureBook,
    source: require("../../assets/ai-creation-style-thumbnails/picture-book.webp"),
  },
];

const MODE_ICON_BY_MODE: Record<CreationSurfaceMode, { color: string; icon: LucideIcon }> = {
  image: { icon: ImageIcon, color: "#2563eb" },
  slides: { icon: Presentation, color: "#7c3aed" },
  pdf: { icon: FileType, color: "#e11d48" },
  word: { icon: FileText, color: "#2563eb" },
  spreadsheet: { icon: Table2, color: "#16a34a" },
};

const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
};

const AI_CREATION_TITLE_GRADIENT_KEYFRAME_ID = "doya-ai-creation-title-gradient-keyframes";
const AI_CREATION_TITLE_GRADIENT_ANIMATION_NAME = "doya-ai-creation-title-gradient";
const AI_CREATION_CONTROL_TEXT_COLOR = "#71717a";
const AI_CREATION_CONTROL_MUTED_COLOR = "#71717a";
const AI_CREATION_CONTROL_ICON_COLOR = "#71717a";
const AI_CREATION_CONTROL_TITLE_COLOR = "#a1a1aa";
const AI_CREATION_PROMPT_LINE_HEIGHT = 24;
const AI_CREATION_PROMPT_MIN_ROWS = 3;
const AI_CREATION_PROMPT_MIN_HEIGHT = AI_CREATION_PROMPT_LINE_HEIGHT * AI_CREATION_PROMPT_MIN_ROWS;
const AI_CREATION_PROMPT_MAX_HEIGHT = AI_CREATION_PROMPT_LINE_HEIGHT * 5;
const AI_CREATION_TITLE_GRADIENT_KEYFRAME_CSS = `
  @keyframes ${AI_CREATION_TITLE_GRADIENT_ANIMATION_NAME} {
    0% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
    100% {
      background-position: 0% 50%;
    }
  }
`;

interface InspirationItem {
  order: number;
  source: ImageSourcePropType;
  height: number;
}

interface AiCreationFeatureItem {
  key: TranslationKey;
  mode: CreationMode;
  source: ImageSourcePropType;
  width: number;
  accentColor: string;
  backgroundColor: string;
  hoverBackgroundColor: string;
  pressBackgroundColor: string;
}

interface VisualStyleOption {
  key: TranslationKey;
  source?: ImageSourcePropType;
  value: VisualStyle;
}

const INITIAL_INSPIRATION_COUNT = 35;
const INSPIRATION_PAGE_SIZE = 15;
const INSPIRATION_TILE_DESIGN_WIDTH = 294;
const SUBTITLE_TYPEWRITER_STEP_MS = 55;

const AI_CREATION_FEATURES: readonly AiCreationFeatureItem[] = [
  {
    key: "aiCreation.feature.generateImage",
    mode: "image",
    source: require("../../assets/ai-creation-inspiration/feature-01.png"),
    width: 166,
    accentColor: "#8b5cf6",
    backgroundColor: "#faf7ff",
    hoverBackgroundColor: "#f4ecff",
    pressBackgroundColor: "#ede2ff",
  },
  {
    key: "aiCreation.feature.makeSlides",
    mode: "slides",
    source: require("../../assets/ai-creation-inspiration/feature-02.png"),
    width: 149,
    accentColor: "#f97316",
    backgroundColor: "#fff8f1",
    hoverBackgroundColor: "#ffedd5",
    pressBackgroundColor: "#fed7aa",
  },
  {
    key: "aiCreation.feature.makePdf",
    mode: "pdf",
    source: require("../../assets/ai-creation-inspiration/feature-03.png"),
    width: 179,
    accentColor: "#ef4444",
    backgroundColor: "#fff5f5",
    hoverBackgroundColor: "#fee2e2",
    pressBackgroundColor: "#fecaca",
  },
  {
    key: "aiCreation.feature.writeDocument",
    mode: "word",
    source: require("../../assets/ai-creation-inspiration/feature-04.png"),
    width: 149,
    accentColor: "#2563eb",
    backgroundColor: "#f4f8ff",
    hoverBackgroundColor: "#dbeafe",
    pressBackgroundColor: "#bfdbfe",
  },
  {
    key: "aiCreation.feature.makeSpreadsheet",
    mode: "spreadsheet",
    source: require("../../assets/ai-creation-inspiration/feature-05.png"),
    width: 163,
    accentColor: "#22c55e",
    backgroundColor: "#f3fbf5",
    hoverBackgroundColor: "#dcfce7",
    pressBackgroundColor: "#bbf7d0",
  },
];

const INSPIRATION_PROMPTS: readonly string[] = [
  "纯白色纸张破洞视角，洞边缘有撕纸毛绒状白边，洞后是浅蓝色头发 Q 版盲盒公仔，公仔戴透明粉色圆框眼镜（头顶架同款小眼镜），蓝发别小纽扣，穿蓝黄裙配白色毛绒围脖，皮肤粉嫩，眼睛通透带星光，潮玩手办摄影风格，干净整洁，构图简单。比例1:1",
  "厚涂油画风格，英短蓝猫脸部特写，蓝灰色猫毛纹理根根分明，琥珀色圆形大眼睛里装着整片蓝色海底世界，彩色热带鱼群在海草与珊瑚间游动，背景为纯黑色，细节生动梦幻，油画笔触清晰，竖版构图。比例3:4",
  "搞怪手写风励志标语壁纸，竖版构图，深蓝底+撞色标签排版，活泼接地气。\n超大主标题居中：毛笔手写「今天早睡了吗？？？」，搭配卡通月亮、闹钟、星星装饰。\n多层彩色标签标语错落堆叠：\n「能早睡就早睡 忌熬夜刷手机」\n「熬夜没有前途」\n「不喝奶茶不吃夜宵」\n「多睡 多运动」\n「要健康作息」\n「早睡打卡中」\n粗粝毛笔字体，视觉冲击力强，搞怪励志，适配作息自律打卡。比例3:4",
  "复古摩登画报插画，哑光质感，复古柔棕米黄配色，线条优雅复古。\n老式复古咖啡馆内景，复古沙发、落地灯、咖啡机、绿植盆栽、看书的优雅人物，窗光影错落，细节精致，年代感十足。比例3:4",
  "采用经典凹版版画艺术风格，主体为雅致的中式庭院景致，画面核心是古朴的木质亭阁与飞檐翘角，周围环绕着蜿蜒流水、叠石假山与盛放的牡丹花枝。整体运用暖橙、藏青与纯白三色搭配，前景以舒展的兰草与湖面浮萍点缀，中景细致描绘回廊窗棂与庭院草木，背景衬以轻柔流云。外轮廓使用0.8mm扎实线条，内部纹理以0.1mm精细线条刻画，保留铜版雕刻的颗粒质感与复古线条肌理，画面层次丰富细腻，国风氛围感强烈，高清精致。比例3:4",
  "国潮毛笔书法字体LOGO，粗粝飞白笔触+水墨肌理，国风高级感。\n居中主标题大字：「日进斗金」，搭配金币、钱包小插画，左上角红色印章「暴富」。\n底部毛笔拼音/英文：「Ri Jin Dou Jin」，白色背景，水墨质感，力量感拉满，适配搞钱标语设计。比例3:4",
  "浅灰背景上的复古音乐创作3D贴纸拼贴海报，所有元素都像真正的贴纸一样独立平铺，带少许投影与白色切边，整体集中经典黑、酒红、奶白、银灰和少量樱桃红，内容由 8号台球、镜面迪斯科球、黑胶唱片、汽水罐、黑色头戴耳机、红心图案、星形徽章、电影场记板、经典帆布高帮鞋、红色电吉他、双人子、棒棒糖和复古卡通头像组成，中央用黑体呼应“I LOVE SOUND”，字形粗重简洁，整体樱桃风格带有欧美复古流行文化、摇滚乐、街头派对和千禧年青春文艺，适合音乐海报、手拼贴、周边设计和社媒封面视觉。比例9:16",
  "整体风格：简约粗轮廓线条logo，圆润高级扁平化，单张图标准3×3九宫格，9枚独立品牌logo，每一个自带搭配文字，配色互不重复，纹理细腻，图形元素丰富，商用设计感，统一画风，超高细节。\n1.月亮猫咪LOGO，搭配文字「MOON CAT」，紫灰渐变底色，星月线条纹路，慵懒极简造型\n2.云朵小熊LOGO，搭配文字「SOFT BEAR」，奶白色浅蓝底色，蓬松肌理，柔和光影层次\n3.星光狐狸LOGO，搭配文字「STAR FOX」，暗夜藏蓝底色，细碎星光装饰，高级精致\n4.山茶小兔LOGO，搭配文字「FLOWER BUN」，淡粉柔色底色，花瓣纹理环绕，温柔治愈\n5.机车黑豹LOGO，搭配文字「BLACK SPEED」，哑光深灰底色，机械线条细节，酷感极简\n6.海盐海豚LOGO，搭配文字「SEA DOLPHIN」，清透青蓝底色，水波纹路，简约流畅\n7.烘焙小猫LOGO，搭配文字「SWEET BAKE」，焦糖浅棕底色，甜点细碎装饰，细腻质感\n8.森林小鹿LOGO，搭配文字「DEER WOOD」，墨绿色底色，叶脉纹理点缀，自然高级\n9.霓虹猫头鹰LOGO，搭配文字「NIGHT OWL」，酒红哑光底色，几何边框，潮流设计。比例3:4",
  "竖版卡通扁平海报，暖粉网格背景；中央卡通女孩举黄色日历牌，旁有笑脸emoji和回形针装饰。\n文案：\n主标题：进店指南\n副标题：开业福利全攻略\n优惠：全场好物5折起\n福利：进店即送定制贴纸1张\n底部小字：快来打卡！比例3:4",
  "治愈系毛绒刺绣风卡通贴纸海报，淡紫色背景，仿毛线刺绣肌理，色彩明亮活泼。\n错落排布多套造型的兔子贴纸：穿碎花裙的兔子、戴花环帽的兔子、抱郁金香的兔子，搭配刺绣花草元素：郁金香、樱花、小雏菊。\n点缀手写短句：「Spring Day」「Blossom」「Hop~」，整体软乎乎的童趣感，无AI过度平滑，保留刺绣原生质感。比例3:4",
  "春日清新弥散风饮品海报，竖版构图，主体草莓气泡水居中，柔焦虚化通透质感。\n多层文字错落排版：顶部明黄大字「SPRING」，搭配粉色主标题「&春天你好」，副标题「（春日甜蜜 正在派送）」。\n画面点缀草莓、薄荷叶、星光，粉色标签「春天的味道」，蓝色标签「HELLO」，底部「HELLO SPRING 」，粉白+明黄撞色，条纹背景，清新治愈，适配春日宣传。比例3:4",
  "几何艺术扁平风，块面拼接构图，低饱和灰粉橘配色，线条极简高级。\n海边城市海岸线，几何楼宇、沙滩海浪、落日渐变天空、飞鸟剪影，构图精致大气，元素丰富克制，文艺高级氛围感。比例3:4",
  "拼贴风旅行海报，清新蓝白配色，手绘涂鸦+实景拼贴。\n\n• 拼贴元素：海边斑马线、沙滩路牌、海浪特写、椰子树剪影。\n\n• 文字排版：\n\n◦ 主标题（手写体）：去看海吧\n\n◦ 英文点缀：Go to the sea\n\n◦ 路牌文案：一直向往，奔赴在海边的路上\n\n◦ 小字文案：\n累的话就去看海吧！吹吹海风，听听浪声，和夏天撞个满怀。\n\n• 氛围：清新治愈，充满海边旅行的松弛感。比例3:4",
  "像素风标题字效，高饱和橙黑配色，街头感拉满。\n\n• 主标题：城市漫游（像素块描边，橙黄底色+黑色粗体字，边缘做毛边像素颗粒效果）\n\n• 英文副标：CITY WANDER\n\n• 贴纸元素：左上角黄底贴纸写着「2026 STREET」，右下角贴纸写着「出逃计划」，搭配小相机涂鸦。\n\n• 整体氛围：街头潮酷感，充满城市探索的活力。比例3:4",
  "复古胶片感海报，浅蓝调做旧纸，挂在夏日树枝上，背景是阳光树叶与草地光斑。\n\n• 文字内容：\n\n◦ 手写体主文案：「我整天追着风跑，直到夏天退烧。」\n\n◦ 英文点缀：MANY WINDS BLOW / I LOVE SUMMER.\n\n◦ 署名：「佚名」《夏日晚风》\n\n◦ 顶部版权：©SUMMER。比例3:4",
  "纯色背景，极简艺术+弥散渐变模糊风格，由各色光效作用生成的温柔花卉艺术风格，视觉错觉，简化的流行文化元素，马卡龙色彩抽象化。\n画面正上方有极细无衬线字体“春日来信”，\n艺术，高级的氛围感，干净，简洁，极简，温柔，治愈，艺术性，光线追踪，内容简洁，想象力爆表的获奖作品，光影加重，扁平化。比例3:4",
  "3D 软胶质感拟人生活用品集合，浅灰色哑光背景，六件 Q 萌大眼单品分两列排版：雾霾蓝色手提包、橙色花朵造型抽纸盒、薄荷绿复古台式电脑、天蓝色小台灯、橙黄色猫爬架、浅蓝色条纹小桌子，每款都带着圆溜溜黑色大眼睛，果冻质感软萌可爱，治愈系 3D 风格，竖版构图。比例3:4",
  "3D盲盒手办渲染，高光通透质感，精致建模，色彩鲜亮干净。\n迷你海岛小岛场景，白沙滩、蔚蓝海水、椰子树、小木屋、游泳圈、遮阳伞，Q版小人悠闲度假，构图饱满，层次立体，潮玩高级感。比例3:4",
  "竖版清新胶片风海报，蓝调质感，松弛感拉满。\n\n• 背景：夏日傍晚的橘粉渐变天空，带着细碎的光斑，像相机拍出的漏光效果。\n\n• 主体：画面右侧是几枝被风吹歪的狗尾巴草，前景虚化，带着胶片颗粒感。\n\n• 文字信息：\n◦ 中间手写体主标题：「城市出逃计划」，英文 Summer Escape\n\n◦ 括号小字：Hello Summer，英文 The wind blows where it will\n\n◦ 底部两条弧形标签：「风里藏着自由」「逃离格子间的夏天」\n整体氛围：清爽自由，把日常出逃的松弛感拉满，和原图的春日感完全不同。比例3:4",
  "拼贴风海边画报，竖版构图。\n\n• 背景：外框是淡蓝色，中间是撕边的浅蓝水彩晕染底色，带颗粒质感。\n\n• 文字：多条蓝色手写英文斜向排列，搭配黑色手写中文「奔赴海边，和夏天撞个满怀」，下方小字「海浪、沙滩、落日，所有烦恼都被海风带走」。\n\n• 装饰元素：海浪线条、贝壳贴纸、椰子树剪影，右下角是一只躺在沙滩上的遮阳伞剪影。\n\n• 底部标签：「海边度假画报」「100次·说走就走·旅行」，整体清爽治愈，充满夏日松弛感。比例3:4",
  "高颜值萌宠时尚写真，暖黄色纯色背景前，一只奶白色长毛直立出镜，头戴浅珊瑚粉丝巾帽，佩戴圆框糖果色墨镜，丝巾在胸前垂落形成松果蝴蝶结造型，头发蓬柔柔和，光线明亮明显，以奶白、柠檬黄、珊瑚粉、橙黄为主，构图居中，背景简洁，带轻微摄影棚阴影，时尚、俏皮、可爱，兼具杂志封面与社交媒体头像风格，超清亮点，锐利细节。比例3:4",
  "木质拼贴扁平字海报，深咖色背景，用原木木纹木片+奶白/焦糖/墨绿咖啡色系块，拼出立体大字「手作咖啡」，融入咖啡豆、咖啡杯、拉花等咖啡元素造型，真实木纹肌理，手工感，温暖治愈，底部标注小字「4 月 咖啡季」，咖啡元素点缀。比例3:4",
  "新中式国潮风奇幻植物插画海报，竖版构图，高饱和撞色+细腻线条，治愈奇幻。\n巨型银杏叶、银杏果做主体，小人物+小鹿点缀角落，左上角英文标题「GOOD THING 」。\n克莱因蓝+暖橙+米白撞色，细腻线条纹理，秋日治愈场景，适配秋日IP/绘本宣传。比例3:4",
  "纯白极简背景的未来感3D头像海报，顶部以小型浅粉雾紫无衬线字写“DIGITAL MUSE”，字距宽、背光略低，作为背景标题横向铺开，画面中心为半身潮流女孩形象，深棕高丸子造型，佩戴镜面银色猫耳头饰、科技感耳饰和珠光配件，周边多个3D拟物标签元素，如软绒字母云、圆润服饰、亚克力小徽章与半透明社交气泡，采用了结局银白、奶咖、樱粉、雾蓝和浅灰，人物服装与配件未来标记Y2K风、精致商业修图随后和柔焦棚拍摄，整体构图居中简洁，兼头像设计、潮流社媒封面和3D虚拟时尚视觉效果。比例9:16",
  "厚涂油画风格猫咪插画，克莱因蓝背景（有厚涂颜料肌理），虎斑橘猫从蓝色墙与浅蓝色门框缝隙探出上半身，眼睛眯成月牙，嘴角上扬微笑，阳光打在猫脸上形成温暖金色光影，笔触松弛自然，治愈系动物油画风格。比例1:1",
  "扁平卡通插画，粗线条手绘风格，浅蓝+浅黄配色，清新活泼。\n画面中心是圆形野餐垫，周围围着手拿绘本、笔记本的小朋友，还有一只趴在书上的小柯基。垫上摆着绘本、汽水和小零食，散落着气球、风车、小书本等元素。\n文字排版：\n\n• 主标题：夏日绘本分享会\n\n• 副标题：和绘本一起过夏天\n\n• 时间：6月8日 - 6月22日 \n\n• 底部小字：儿童绘本共读活动，一起在故事里找夏天。比例3:4",
  "竖版宠物市集主题宣传海报，鱼眼镜头实拍风格，活力动感，适配市集活动、宠物宣传。\n\n【背景与主体】\n1.  主背景：宠物市集草坪实拍图，鱼眼广角镜头拍摄，画面边缘做黑边喷绘肌理，强化动感；\n2.  视觉核心：画面中心一只布偶猫，表情生动，互动感强；\n3.  底部背景：橙色渐变背景，做视觉分割，突出主标题。\n\n【文字排版】\n1.  顶部品牌区：橙色圆角栏，内放「布丁宠物市集」品牌LOGO；\n2.  右上角标语区：绿色手写涂鸦字「萌宠集结 快乐赶集」；\n3.  底部主标题区：超大号白色毛笔书法字「毛孩子的狂欢」，搭配黄色涂鸦线条装饰；\n【整体风格要求】\n鱼眼镜头实拍，真实生动，橙色+鲜绿撞色，活力动感，主体突出，文字层级清晰，治愈可爱，适配宠物市集活动宣传。比例1:1",
  "搞怪手写风学生情绪海报，竖版构图，软萌云朵异形边框，奶黄+暖黄+深棕撞色。\n超大主标题大字错落堆叠：「作业是堆成山的 笔是拿不动一下的」，黄色高亮标签「学生党！！！」。\n角落搞怪小元素：摆烂表情、扔笔手势，侧边拼音「XUE SHENG DANG!!! / ZUO YE DUI CHENG SHAN DE」，网感拉满，适配学生党吐槽海报。比例3:4",
  "长场雄日系极简扁平风，利落细线条，几何精致构图，城市极简建筑群场景，楼宇轮廓、天桥、行人剪影、落日余晖，低饱和冷调高级配色，线条规整精致，元素丰富但极简克制，文艺高级感。比例3:4",
  "3D 毛绒质感潮玩贴纸集合，纯白色背景，四组毛绒人物元素分区域排版：戴明黄色针织帽的男生举着橙色带笑脸的相机，穿黄色套装的女生从棕色礼盒里探出头，粉紫色头发女生躺在棕色月牙沙发上玩手机，圣诞帽男生坐在绿色月亮上拿着苹果，毛绒纹理清晰细腻，色彩活泼明亮，可爱治愈 3D 风格，方版构图。比例3:4",
  "极简扁平插画，低饱和度墨绿+米色调，斜向线条背景模拟林间小路肌理。\n\n• 主体：俯视角的林间小路，一个穿着卡其色外套的男孩正骑着单车，车轮碾过落叶，向前驶去。\n\n• 元素：上方是树枝剪影，几只飞鸟掠过，背景是干净的米绿底色。\n\n• 文案：\n\n◦ 主文案：「我看到风如何穿过林间，越过山坡，便遇见了自由的味道。」\n\n◦ 英文：It ushered in freedom.\n\n◦ 日期/署名：右上角「22 SAT.」，右下角「SATURDAY 星期六」。比例9:16",
  "极简浅灰金属雕塑风3D背景元素贴纸合集，整体采用均匀垂直排布与单个物体独立展示方式，围绕玫瑰银、浅樱粉、镜面铬银与小草莓果粉高光，所有元素具有表面强镜面反射、大象金属作用、精致倒角与柔和环境雾光，包含形状爱心、金属元素、抽象星形、流动铬银块、弹簧线圈、樱桃、浮雕饰品、玫瑰花、五角星、金属骷髅、泪滴、荆棘丝带和花枝，整体风格、冷艳、高级感强，兼具轻奢饰品、赛博雕塑与时尚浮雕的形象表达，适合高端形象、海报装饰、品牌KV扩展和潮流电商主视觉元素。比例9:16",
  '清新胶片风海报，低饱和高对比，轻微颗粒感，夏日治愈氛围。\n画面主体：一杯冒着气泡的橘子汽水，杯壁挂着水珠，背景是浅蓝天空和棉花糖云，底部是细碎的草地。\n文字排版：\n\n• 顶部小字：summer is coming\n\n• 主标题（白色手写体）：快乐夏天\n\n• 引用小字："Soda water and summer breeze are the best pair."\n\n• 左下角手写文案：夏天的风，和橘子汽水一样甜\n\n• 底部小字：SUNNY DAY / COOL DAY 。比例',
  "背景是清晨的雾中森林，浅绿与米白渐变，阳光透过树叶洒下光斑。\n中间大字用深绿手写体：「慢下来，生活自有答案」，搭配简约云朵线条装饰。\n左侧文案：「开启今日好心情」，小字配文「允许一切发生，也允许自己慢慢来」。整体松弛治愈，充满自然清新感。比例3:4",
  "北欧极简扁平插画，干净利落色块，低饱和清冷配色，几何简约造型。\n湖边独栋小木屋，草坪、湖水、白桦树林、白色云朵、木桥长椅，配色清爽高级，元素丰富不杂乱，构图精致舒服，静谧松弛感。比例3:4",
  "厚涂油画质感插画，竖版构图，背景是旋转的糖果色星空，粉蓝渐变，肌理厚重。\n前景是穿蓝裙子的女孩，坐在一片巨大的荷叶上，旁边盛开着一朵粉色的玫瑰。\n星空中点缀着发光的蘑菇和怀表，整体奇幻浪漫，色彩明亮梦幻，笔触富有层次。比例3:4",
  "现代几何半色调波普风节气海报，竖版构图，网点肌理+撞色块面，极简高级。\n异形圆角主视觉框，主题元素（春雨、嫩芽、禾苗）居中贯穿，分块文字排版：\n左上角：谷雨 2026 / 04 / 20\n框内分块文字：「万物生长」，侧边仅标注极简装饰英文「Spring」\n嫩绿色+天蓝色+米棕撞色，春日清新感，适配谷雨节气宣传。比例3:4",
  "现代装饰版画风格，Risograph印刷质感，网点肌理+线条纹理，清新柔和配色。\n画面主体是春日森林溪涧场景，溪流蜿蜒穿过林间，水面倒影着树木与天空，溪边生长着蕨类、苔藓、野花，阳光透过树叶洒下斑驳光影。不同植物用不同的线条和网点纹理区分，整体色彩以嫩绿、浅蓝、米白为主，点缀鹅黄、淡粉，构图饱满，静谧治愈，充满春日生机。比例3:4",
  "竖版春日野餐主题撞色拼贴风海报，实景+卡通涂鸦结合，嫩绿+荧光粉撞色，清新治愈。\n顶部超大号白色书法大字「去有春光的地方」，荧光粉描边+花朵云朵装饰，英文标语「FROM CITY TO SPRING」。\n画面叠加卡通野餐篮、小蝴蝶涂鸦，底部标注活动时间【Time 3.1>>5.31】，右下角英文「GO OUT FOR (SPRING)」，野餐氛围感拉满。比例3:4",
  "吉竹伸介绘本风格，随性松弛粗线条，画面丰富有细节，夏日居家窗边场景，小人靠窗台吹风，窗外大树、流云、飞鸟、盆栽绿植，桌上摆放汽水与书本，莫兰迪浅柔配色，生活化细节拉满，安静治愈，构图饱满不拥挤。比例3:4",
  "清新手账风干货海报，浅绿+奶白配色，网格纸背景。\n\n• 标题栏：顶部浅绿色撕边纸，写着宿舍党超实用收纳技巧\n\n• 内容模块：\n\n1. 利用垂直空间\n用门后挂钩、墙上置物架，把包包、帽子挂起来，不占桌面地方。\n\n2. 分类收纳盒\n用带盖收纳盒把衣服、文具、杂物分开装，贴上标签，找东西一目了然。\n\n3. 床底利用起来\n床底放扁平收纳箱，装换季衣服和被子，不占房间空间又防尘。\n\n• 装饰元素：小收纳盒、书本手绘涂鸦点缀，清新又实用。比例3:4",
  "竖版海报，明亮高饱和配色，马克笔手绘质感。\n\n• 背景：卡通西瓜切片、冰棍、太阳涂鸦，铺满浅黄底色，线条活泼随性。\n\n• 文字排版：\n\n◦ 主标题（圆润卡通字）：西瓜味的夏天\n\n◦ 小字：空调+西瓜=快乐夏天\n\n◦ 角落涂鸦：小太阳+爱心\n\n• 氛围：元气搞怪，适合朋友圈或活动海报。比例3:4",
  "高饱和丙烯插画风格，深紫色齐刘海短发少女，瞳孔里闪烁着彩虹与星星光斑，脸颊带着蓝紫色红晕，周围环绕彩色流光、四角星、荧光绿装饰元素，背景为浅紫撞色纹理，笔触粗犷浓烈，色彩跳脱活泼，梦幻潮流风格，方版构图。比例3:4",
  "清新治愈系生活方式海报，竖版构图，实景背景是淡蓝春日晴空与青草地。主体是一只手拎着装满三明治和白桃气泡水的野餐篮，篮边用手绘线条勾勒。\n左侧竖排手写中文主标题：「赴一场春野」\n底部短句：「去草地上，和春天碰杯」\n点缀淡绿色手写英文：To Spring\n整体温柔治愈，充满春日松弛感。比例3:4",
  "竖版高饱和线条涂鸦海报，亮蓝色背景，粗黑轮廓线，孟菲斯风格装饰。\n\n• 主体：中心是戴着柠檬片帽子的原创IP「汽水汽水」，圆脸蛋、大笑表情，穿着白T恤，用粗黑线条勾勒，帽子和T恤用亮黄、浅粉填充。\n\n• 装饰元素：周围用粗线条画满涂鸦风的汽水罐、冰块、太阳、星星、爱心、汽泡符号，和主体融为一体。\n\n• 文字信息：\n\n◦ 顶部大字：SODA DAY\n\n◦ 副标题：「夏日汽水节快乐」\n\n◦ 日期：2026.06.14\n\n◦ 底部文案：白色文字「今天要吨吨吨，做个清爽小顽童」\n\n◦ 底部小字：XIA RI KUAI LE\n整体氛围：元气清爽，把夏日汽水的快乐用涂鸦线条表现出来，和原图的儿童节主题完全不同。比例3:4",
  "竖版元气清新风海报，背景是澄澈的夏日蓝天与棉花糖云朵。\n中间核心视觉：用云朵拼成的「夏天」两个大字，搭配手写花体英文 Hello Summer。\n底部短句：「带上汽水，去和夏天撞个满怀」\n四周点缀亮黄色线条星星、小云朵装饰，整体元气明亮，充满夏日清爽感。比例3:4",
  "橙色高水位背景的3D潮玩人物海报，背景中加入超大半透明英文字母和白色涂鸦空气笔刷，形成街头感，画面中央一个玩偶精致的都市少女，穿深海军蓝毛绒针织帽与同材质外套，内搭深蓝上衣，搭配细颈、金属耳环和长辫造型，手持智能手机，人物皮肤细腻、眼睛大而有神、整体像高端潮玩公仔结合与时尚CG角色体，左下用大号白色简洁字体写“GLOW”，旁边加入极小号排版文字块、数字编码、条形码和产品说明式英文，整体色彩以高钾橙和下部蓝强烈配合，画面构成潮流杂志封面、3D角色海报与时尚融合广告的高级视觉效果。比例9:16",
  "极简日系平面海报，背景纯白带丝网印刷颗粒，细腻粒子肌理，半调网屏效果。\n涂鸦手绘风格，高饱和多巴胺配色（霓虹粉、深海蓝、荧光绿），极简线稿。\n画面主体为宇宙星际聚会，各种卡通宇航员、星球飞船聚集，融入波点图案、星际印花。\n大师手稿，杰作级别，白色背景，极致抽象变形，孟菲斯风格矢量插画。\n采用非对称图形布局，点线面随机组合碰撞，图形故意扭曲旋转，极具视觉冲击力。比例3:4",
  "可爱治愈系3D春日海报，明亮天空蓝背景与外侧柔焦草地丘陵，前景是一组微笑表情的拟人玫瑰角色，花瓣像蓬松绒布玩偶，中心花盘带卡通表情，三朵高低错落均匀在嫩绿色草坪上，周围散布色彩、蘑菇状小造型件与迷你花丛，天空外部白色线描云朵色彩，整体以天蓝、嫩粉、浅橙、湖蓝、草草为主绿、明黄为主，材质柔软，带有毛绒玩具和土公仔结合的重力，上方安排超大白色中文标题，粗圆无衬线字形，搭配轻便手写英文扩展，小号副标题位于主标题下方，底部加入标签和品牌角标信息，版式可爱，画面充满春天气息、童趣与商业插画海报感，超清细节，前期海报。比例9:16",
  "高饱和撞色潮流海报，亮蓝底色，橙+黑粗线描边。\n画面主体是一只比出加油手势的手，手腕戴着运动手表，指尖指向运动方向标。\n文字排版：\n\n• 顶部小字：Move Forever 2026 aug.\n\n• 主标题：（限定）运动打卡\n\n• 合作条：1891 × 城市运动联盟\n\n• 时间标注：6 月1日-6 月31日\n\n• 底部文案：完成打卡赠定制运动腕带\n\n• 右侧元素：带绳的橙色限定小吊牌，写着「动出好状态」。比例3:4",
  "水彩手绘插画，暖调治愈风格，白色背景。\n\n• 画面主体：前景是一扇被雨水打湿的玻璃窗，用深蓝色水彩勾勒窗框；窗内映出雨夜的街景：暖黄色路灯、撑伞的行人、模糊的店铺招牌，带着雨水的朦胧反光。\n\n• 窗外：是模糊的深绿梧桐叶，雨滴顺着玻璃滑落，用浅蓝色线条表现雨丝。\n\n• 右下角手写体英文：view\n整体氛围：温柔静谧，把雨夜的浪漫藏进了窗景里，和原图的夏日海边感完全不同。比例3:4",
  "低矮灰粉与奶油白的怪趣日系插画，垂直版满构密集了一群神情冷漠的小猫脑袋，中间留着一个留着齐刘海的少女半张脸，人物被猫群完全包围，只包括眼睛、鼻梁和一点衣领，猫咪颜色由乌黑、奶白、浅姜和浅桃组成，全部拥有半睁闭的厌世眼神与细半胡须，轮廓略带手颤感和纸上彩铅触感，少女神情又平静，画面几乎没有背景留白，相信角色和猫咪毛团形成包围式包围感，整体造型、安静、冷幽默，像独立插画师的情绪壁纸和厌世萌宠短篇封面。比例9:16",
  "软萌简约风，浅紫温柔底色，点缀手绘小元素。\n\n• 标题大字：粉丝作品征集\n\n• 副标题：你创作，我上墙\n\n• 参与方式：\n带话题#我的专属头像#，晒出你用我家模板做的头像，并@我的账号。\n\n• 活动奖励：\n点赞数TOP3，即可获得定制头像模板使用权+专属头像挂件一套。\n\n• 小元素：星星、画笔、调色盘手绘图标点缀，整体清新软萌。比例3:4",
  "实景涂鸦风氛围感海报，竖版构图，背景是老巷街角的黄昏街景。\n用姜黄色涂鸦线条勾勒路灯轮廓，中间大字：「街角日记」，搭配手绘的咖啡杯线条。\n角落点缀英文：「Street Story」、日期「05.10」、禁止emo的手绘符号，底部文案：「平凡的角落，也藏着小美好。」，整体复古治愈，充满市井烟火气。比例3:4",
  "世界名画《呐喊》二创 3D 插画，背景为厚涂肌理橙、紫、蓝三色旋涡状天空，前景是圆滚滚橘色胖猫，蓬蓬软毛，超大圆眼睛，捂着脸、嘴巴大张，做出名画中震撼表情，融合毛绒 3D 与抽象背景，搞笑风格，名画恶搞插画类型。比例3:4",
  "软萌毛毡风插画，6个毛毡元素整齐排列，背景为干净的米白色。\n\n• 棕色毛毡小松鼠，抱着一颗松果，带着腮红。\n\n• 灰色毛毡小兔子，长耳朵耷拉着，抱着一根胡萝卜。\n\n• 橙色毛毡小狐狸，尖耳朵蓬松尾巴，带着微笑。\n\n• 白色毛毡小羊，卷卷的毛，带着蝴蝶结。\n\n• 黄色毛毡小刺猬，背上扎着几颗红色毛毡小果子。\n\n• 绿色毛毡小树桩，旁边长着一朵红色毛毡小蘑菇。\n整体色调温暖柔和，毛毡质感蓬松柔软，充满森林治愈感。比例3:4",
  "厚涂油画风格，鲜红饱满的奶油草莓堆满整个画面，奶白色短毛小猫窝在草莓缝隙中，睁着圆溜溜的浅棕色眼睛看向镜头，草莓表面高光清晰透亮，色彩浓郁鲜亮，毛绒质感细腻，治愈可爱风格，竖版构图。比例1:1",
  "竖版潮酷拼贴风海报，背景是湛蓝的海边沙滩，海浪翻涌，天空飘着云朵。\n顶部大字用白色粗体+柠檬黄描边：「一起去踏浪」，搭配英文「Summer Surf Vibes」，周围点缀手绘太阳、海浪涂鸦。\n画面主体是一辆停在沙滩边的复古冲浪板车，车旁有卡通狗狗贴纸：一只金毛叼着冲浪板，一只柯基在沙滩上打滚，还有一只柴犬趴在遮阳伞下吐舌头。\n底部标注活动时间「05.10 >> 05.15」和「SUMMER WAVE」，整体清爽元气，充满夏日活力。比例3:4",
  "未来主义光效应艺术风格，纯克莱因蓝背景，幻觉重复致幻，弥散，色彩半调，丝网印，半调图案，颗粒感复古，随机模糊，随机构图。\n主体：随机几何线条、随机霓虹元素，从下方城市天际线生长，最终组成上海东方明珠的形状，霓虹簇拥，动态大张力角度，视觉错觉，超现实主义，投影荧光柔光虚化色散，反光珠光，高级氛围感。比例3:4",
  "六宫格平涂治愈系猫咪插画，背景为亮黄色与湖蓝色交替纯色块，每格一只黑白奶牛猫，装饰分别为：左上角浅紫兔耳头套、右上角酒红色大领结、中左黄色向日葵头套、中右粉色牛仔帽配三角巾、左下橙色白波点围巾、右下爱心眼镜配条纹发带，猫咪表情软萌圆润，线条简洁，可爱宠萌表情包与头像插画风格。比例3:4",
  "竖版夏日海边主题治愈系海报，实景+手绘涂鸦结合，清新活力，适配海边出游、度假宣传。\n\n【背景与主体】\n1.  主背景：**蔚蓝大海+沙滩实拍图**，夏日氛围感拉满；\n2.  手绘涂鸦元素：用白色简笔线条点缀海浪、椰子树、冲浪板、小螃蟹，活泼治愈；\n3.  视觉核心：画面中沙滩遮阳伞、躺椅，度假感拉满。\n\n【文字排版】\n1.  顶部主标题区：\n    - 超大号白色手写书法字「夏日逐浪」，搭配彩色贝壳装饰；\n    - 主标题下方：白色/黄色标签框内「想借着夏天的名义 去看海吹风！」；\n【整体风格要求】\n实景+手绘涂鸦结合，清新治愈，活力满满，主标题醒目，标语活泼，信息层级清晰，夏日清凉氛围，适合海边出游宣传。比例3:4",
  "童趣感平面海报设计，横版，天蓝、亮黄、粉紫、草绿高饱和配色，主体为几件夸张可爱的塑料玩具：小恐龙滑板车、胖胖飞机、糖果相机、笑脸机器人，搭配波浪描边、手写拟声字、棋盘格边框、粗黑轮廓字和贴纸排版，标题为“玩心放风中”，副标题“周末无聊解除指南”，整体像创意快闪活动或儿童美学展海报，轻松、跳跃、信息感丰富、构图夸张有趣。",
  "风格： 复古胶片电影风格，带有浓郁颗粒感和噪点。色彩高饱和。\n主体与构图： 画面下方是一个[穿着白色棉麻长裙的女孩背影]，她头戴草帽，正站在一座古老的石桥上望向远方。背景是巨大且明亮的湛蓝色天空和厚厚的棉花糖白云。\n文字排版： 画面上方有巨大的、亮黄色的手写艺术字体标题“我只需要路上的风”。小飞机简笔画装饰。\n色彩： 纯净的天蓝色背景，搭配明亮的柠檬黄色和石桥的灰褐色。红色的双肩包作为视觉点缀。",
  "一张梦幻唯美的毛毡风景海报。画面上半部分是由大片厚实的、带有蓬松肌理的白色和淡蓝色羊毛毡堆叠出的云层。一个色彩鲜艳（红白相间）的毛毡扎制热气球正悬浮在云层之中，热气球的吊篮和缆绳细节均为细羊毛线制作。背景是柔和的夕阳晕染出的粉紫色毛毡天空。整体构图开阔，材质厚重且富有层次感，光影柔和，给人一种温暖、宁静且向上的感觉，CGI渲染，极致毛毡质感。",
  "一幅极简主义矢量插画，以柔和的色块和明亮的糖果色系构成，抽象线条与曲面线条绘制。画面主体由线条设计叠加多个不规则弧形色块，构成江南水乡与沿江城市地标建筑群的彩色轮廓，如拱桥、塔楼、码头、古亭、帆船、现代高楼等，建筑与景观点缀于水岸与洲渚之间。作品结合自然纹理与装饰元素，带有超现实派风格。海报风格融入先锋艺术感，采用时尚字体的大师构图，呈现高清画质。整个画面以纯白色背景呈现，使用 Adobe Illustrator 2025 软件创作。设计灵感来源于 Paul Rand 和 Saul Bass，通过几何形状和大胆色彩传达信息，强调简单性和功能性，参考吴冠中的留白意境。整个画面具有高审美和创意构思，适合获奖海报的水准。文字细节：顶部中央简洁地写着 “LINYI - DESIGN”，下方是小字 “东方意象·自由生长”，字迹纤细，融入画面。",
  "孟菲斯风几何切割主题展览海报，奶白纯色背景，低多边形扁平插画，撞色活泼。\n几何切割猫咪、猫爪错落排布，多层文字分区域排版：\n右上角：2026 3.1-5.7\n右侧：展览地点 城市宠物文化中心 \n支持单位 市农业农村局\n左侧：主办单位 城市宠物协会 \n承办单位 萌宠文化中心 \n设计支持 创意设计工作室\n中部英文：This is a cat\n底部大字主标题：这是猫\n高饱和撞色，软萌治愈，适配萌宠展宣传。比例3:4",
  "节庆活动海报，竖版，橙色底搭配浅蓝边框，中间是一个巨大的绿色毛绒怪物角色，圆眼睛，表情懒懒的，周围有星星、笑脸、小徽章和夸张大字，整体可爱怪诞。主标题改成 “Lazy Bloom Fest”，顶部用粉色立体英文大字弯曲排布；中间环绕怪物身体加白色弧形字 “SOUTH COAST CREATURE FAIR”；底部大字写 “2026 怪趣生活节”；补充信息 “2026.04.17—04.25｜厦门·海风广场”，小字写 “装置展 / 夜市 / 怪物巡游 / 限定周边”。整体像城市青年节庆主视觉，毛绒感强，活泼夸张。",
  "乐高风格，鸟瞰视角，一个繁华的乐高城市街景。街道上排列着五颜六色的乐高模块化建筑，包括警察局、消防局和一家咖啡馆。街道上挤满了乐高小人仔（minifigures），他们正在走路、骑自行车和开着各式各样的乐高汽车。画面充满细节，阳光明媚，色彩鲜艳，具有真实的塑料磨砂质感，最高画质，3D渲染。",
  "一张充满清新气息的春季时尚海报。玻璃质感，画面背景是通透的淡绿色渐变，点缀着几片写实的绿色嫩叶。画面正中央使用具有艺术感、圆润的绿色艺术字体写着巨大的中文“春”字，字体内部填充了花卉的图案。整体视觉效果清新、向上，充满正能量，电影级光影渲染，构图平衡。",
  "装饰感艺术海报，深蓝纯色背景，多只猫朝同一方向奔跑或游动，橘猫、黑猫、白猫交错排列，身体带有花纹、星点和轻微发光纹理，画面有细腻颗粒感，复古神秘，像丝网印刷和梦境插画结合。右上放标题“梦幻漫游 2026”，白色高对比衬线英文和数字竖向排布，整体简洁、安静、有收藏海报感。",
  "复古像素风轻松场景插画，竖版构图，清新蓝白调。\n画面是露天泳池边的派对，泳池边放着彩色泳圈和汽水。\n背景是蓝天白云、棕榈树和远处的度假小屋，整体充满明亮松弛的夏日氛围。比例3:4",
  "旅行主题竖版系列海报，明亮纯色背景，每张一种高饱和主色，画面中间放一张竖向景点照片，外围用一根弯曲彩色线路贯穿上下，线路两端是黑色圆点，四周点缀少量英文地名标签和彩色信息贴。顶部放主标题“沿着风景去西北”，中文用细长现代字体；副标题用英文大写“ROADBOOK OF THE NORTHWEST”；底部放超大“Travel”字样。中间照片对应景点可写：敦煌石窟、天水石窟、临崖古寺、边塞城楼、沙漠月泉、彩丘地貌。信息文案写 “2026 西北地貌漫游季” “建议游览半日到一日” “甘肃文化与地形特别路线”。整体像旅行专题系列海报，轻快、统一、有成套杂志感。",
  "3D毛绒颗粒外观梵高玩手办，立体脸像素造型，橙黄色毛绒凹陷，头戴蓝绿渐趋精致帽，身穿针织纹理雾霾蓝色外套搭配米白色高领内搭，嘴里叼着棕色颗粒外观烟斗，烟斗顶部是奶白色泡沫配色小向日葵装饰，背景为星月夜风格蓝色纹理与向日葵图案，整体毛绒颗粒纹理，清晰创意潮玩风格，写实礼3D，立体版构图。比例9:16",
  "Y2K电子派对海报，竖版，蓝紫霓虹渐变背景，中间是一台打开的复古翻盖手机，屏幕显示荧光粉和黄色短信界面，四周有发光星芒、云朵、渐变光晕和少量像素闪光，未来复古感。主标题“低电量通话”放顶部，超大荧光绿色像素风中文字体；左侧排日期2026.4时间10:26地点复古聚集地，粗无衬线；右侧排嘉宾名单敬请期待，亮黄色发光字；底部放票价99和logo区。整体像电子音乐演出海报，视觉冲击强。",
  "Moebius (Jean Giraud) 风格，极繁主义，莫比斯风格插画，艺术家 Moebius 风格，极致细节，悬浮在空中的巨型岩石浮岛，参天的拱门建筑，空中楼阁，色彩丰富的异域民居，垂直相连的悬空天桥，飞艇码头，色彩层次丰富的建筑外墙，浮岛上的运河一角，淡蓝色透明的空中溪流，淡蓝色的能量水晶，淡紫色的漂浮圆石，瀑布般垂下的藤蔓植物，画面细腻耐看，宁静美好，爬山虎，空中花园，爬藤月季，牵牛花，紫藤花，夜来香，凌霄花，淡紫色和粉色的空中花卉，淡蓝色的奇异花草。",
  "矢量抽象图形，平面设计，线条与几何块面，by Chris Riddell and Kazumasa Nagai，重庆著名景观，气势恢宏，多层叙事结构，无透视，矛盾空间结构，层次分明，抽象的几何状植物，图案点缀，极繁主义，呼吸感，无边框无水印，不对称结构，扁平填色，不可理喻，荒诞，抽象，梦幻，丰富细节，时尚潮流的高饱和配色，采用荧光酸橙绿、电紫、橘红、湖蓝与米白色组合，no people。主体画面由山城建筑、桥梁、阶梯、江水、轨道列车与崖壁植物共同构成，周边加入图腾感符号、几何灯牌、装饰纹样与抽象云块，增强画面的城市辨识度与视觉冲击力。",
  "创作一张绘本风格插画海报，以大面积深青色花园植物图案为背景，纹理细腻，营造安静梦幻的氛围。画面下方呈现一座很小的浅米色尖顶小屋，带暗绿色窗框与暖黄色窗光，周围点缀细小灌木、野花和碎石小路，搭配文字 “IN THE GARDEN, EVERY LITTLE WINDOW HOLDS A WARM STORY.”，搭配细小的制作信息文字。借植物背景、小屋造型与温柔文字，传递安静、治愈的绘本特质。左上角极小字“ILLUSTRATION ARCHIVE”，右下角极小字“GREENFIELD STUDIO”。",
  "明亮天蓝色环抱的复古插画海报，画面中心是主角主体的大型圆润石榴果实，皮以橙红、蜜金和浅杏色颗粒展开表现，顶部斜延长一片深墨绿带叶脉纹的大叶子，背景由浅蓝天空、奶白描边云朵和左上角柔橙太阳构成，整体为童话果趣果园招贴风格，果实表面分散贴附多枚异形标签贴，分别写有“阳光下生长”“新鲜采摘”“蜂蜜”甜”“多汁里面”“与喜悦分享”等文案，字体混用复古衬线、手写体和装饰字，采用酒红、墨绿、奶白、橙等并配粗描边，右侧沿结果弧线排一行英文副标题，底部深绿色菱形色块上围绕轮廓线、小花、果核图案与弧形文字“FRAGRANT·BRIGHT”，中间配一个小号说明文案，整体保留颗粒喷砂、纸版印刷和童书插画般的复古文艺气息。",
  "羊毛毡拼贴绘本插画。画面是一个温馨的小镇街角：彩色毛毡扎成的小房子整齐排列，屋顶上点缀着细小的白色纤维（像春天的柳絮）。一只戴着橙色围巾的小白猫正悠闲地走在由深棕色麻布拼贴而成的鹅卵石小径上。路边是五颜六色的、带有立体绒毛感的羊毛毡花朵。天空是淡淡的粉紫色，带有明显的布料经纬纹理。光影柔和，局部有精致的刺绣线条勾勒轮廓。整体触感柔软厚实，色调温馨舒适，像是一个永远不会醒来的温柔美梦。",
  "极简复古草稿线稿插画，柔和米黄背景。主体松弛速写勾勒石质托盘，摆放磨砂小花瓶、干枝花艺、小众摆件，黑色随性笔触，低饱和灰绿淡淡点缀，肌理细腻。\n中部主标题「森野晚宴」，底部署名「时叙 与 清鸢」，日期「二零二六年 五月初七」。\n高级复古排版，线条原生潦草手绘感，黑白为主，配色克制干净。比例3:4",
  "高水丙烯厚涂插画人物，画面主体为蓝发少女，青色眉毛，极大眼睛，瞳孔有蓝色星星和彩虹渐变，脸颊腮红上有亮小星星，眉毛微着色，穿印有彩色小图案上衣，左臂怀白色小比熊犬，手指甲涂红橙色，笔触肌理明显，色彩对比强烈，多巴胺风格，带流程图设计感。比例3:4",
  "春日系列 3D 海报， 画面中心有一个切口微微掀起，初夏花与藤叶从切开处生长出来，包含山茶花、洋甘菊、鸢尾、铃兰、金鱼草、绣球、细叶草、藤蔓嫩叶；场景中还有一个缀满叶片和缎带装饰的精致圆形礼帽盒，画面整体呈现明亮繁盛、轻盈生长的氛围，还有蜻蜓与小飞蝶停留在礼盒边缘；背景颜色是奶白渐变浅柠檬绿，清新色调，高饱和，画面层次丰富，时尚杂志高奢感。",
  "复古半色调网点印刷风格（Halftone），兼具艺术油画肌理。画面主体是几朵盛放的玉兰花，花瓣层次柔和，光影细腻，背景隐约有一只轻盈蜻蜓盘旋。整体由细腻彩色网点纹理构成，充满复古画报印刷质感。色彩从浓郁的墨绿背景过渡到温柔的玫红与暖金光晕，光影朦胧梦幻。构图优雅舒展，边缘柔和，氛围浪漫复古，如同老杂志艺术插画，高饱和度，装饰感极强。",
  "温柔手账风干货海报，浅粉+奶白配色，网格纸背景。\n\n• 标题栏：顶部浅粉色撕边纸，写着新手友好的基础护肤步骤\n\n• 内容模块：\n\n1. 温和清洁\n早晚用氨基酸洁面，早上可只用清水，避免过度清洁破坏皮肤屏障。\n\n2. 基础保湿\n洗完脸后3分钟内涂爽肤水+乳液/面霜，锁住水分，保持皮肤水润。\n\n3. 防晒必做\n不管晴天阴天，出门都要涂防晒，防止紫外线导致的皮肤老化和晒黑。\n\n• 装饰元素：小瓶子、云朵手绘涂鸦点缀，温柔又实用。比例3:4",
  "画面展现奇幻空中悬浮阶梯场景。阶梯由面包制成，覆着白雪，边缘有绿植点缀。顶端是红顶小屋，几人站立其上。阶梯上有小人活动，还架着梯子。背景是云海蓝天。画面质感细腻梦幻，配色清新柔和，红顶、绿树、白雪与面包色搭配和谐，营造出童话般的超现实氛围。",
  "美式卡通插画，线条干净利落，塑造一个搞怪戏谑的小狗，面部表情荒诞又讨喜，头部比例极度放大，神态灵动狡黠。画面细节拉满，风格原创抽象，极具戏剧张力与喜剧效果。比例3:4",
  "美式复古波普风多巴胺插画海报，竖版构图，高饱和撞色，复古明快。\n巨型猫爪做框架，中间是萌宠乐园场景：猫咪、猫爬架、零食、铲屎官互动。\n顶部用猫毛球组成艺术字主标题「猫咪世界」，粉+蓝+黄撞色，复古波普线条，颗粒质感，活力拉满，适配宠物展宣传。比例3:4",
  "超现实拍摄，梦核怪诞，静谧感，神秘感，复古胶片，大 k师机构图，远景拍摄：一位长黑发少年在风中缓慢行走，动态模糊呈现拖曳曲线感，面部模糊，身穿宽松深蓝长风衣，衣摆遮住手臂与双腿，在起伏流动的深紫色麦田中穿行，仅露出上半身，下半身被麦浪遮挡。人物比例小置于画面中央，前景压暗，远处一点橙光，背景为深邃群青色天空。动态模糊，高对比度，复古胶片美学，戏剧性电影感光影，颗粒感纹理，高饱和高对比配色，低分辨率颗粒质感，油亮光滑画面质地。",
  "极简可爱3D壁纸，大片纯净淡蓝天空下重叠的蓝紫色绒面山丘与荧光草绿色毛绒坡地，中央探出一个发光的圆润小幽灵唇形，明亮，周边几朵粉白末菊与补绿结构，整体整洁，以天蓝、亮蓝、青草绿、浅粉、奶白、柠檬黄为主，表面呈现密集短绒毛轮廓，表面呈现密集短绒毛轮廓，表面简洁，空间简约留白，加强轻松童真、梦幻，适合手机壁纸和IP形象展示，高清、细腻、治愈感强。比例3:4",
  "艺术感，人像摄影，画面背景为鲜艳的红色，强烈的色彩奠定了视觉基调。人物主体呈现出模糊效果，似乎运用了动感模糊或多重曝光技法，光线在人物面部和身上交织，形成光影的碰撞。明亮的光斑与红色背景形成高对比度，营造出神秘、朦胧且富有张力的氛围。这种处理方式弱化了人物具体面貌等细节，更强调光影、色彩组合带来的抽象艺术感，给观者留下广阔的想象空间，传递出一种独特的情绪和视觉体验。",
  "矢量插画。一本巨大的翻开的旧书占据画面中央，书页间是一片微型森林。几个荒诞的象征性角色（如翠鸟、戴着圆框眼镜的蜗牛）在林间青苔小径上漫步。旧书封面采用高饱和度的绿色和粉色块拼接，与克莱因蓝色背景形成强烈撞色。画面构图充满叙事感，营造出一种被困在错位时空里的荒诞宿命感。大量留白，先锋商业艺术风格，8K 高清。画面左上角用极细的黑色无衬线字体，文字“DOUBAO DESIGN”，“Prelude to Spring”。3:4",
  "矢量插画。一个巨大的打开的八音盒占据画面中央，盒内是一座有旋转木马的微型村庄。几个荒诞的象征性角色（如有尾巴的木质椅子、戴着礼帽的橘猫）在鹅卵石巷子里穿行。八音盒外壳采用高饱和度的绿色和粉色块拼接，与克莱因蓝色背景形成强烈视觉冲击。画面构图充满叙事感，营造出一种被困在循环旋律里的荒诞宿命感。大量留白，先锋商业艺术风格，8K 高清。3:4",
  "抽象艺术点绘法（各种波点、颗粒、纹理构成）插画，丝网印刷质感，稚拙笔触的潮流艺术风，融合了复古与当代艺术的特质。画面核心是一个复古相机陈列柜，里面陈列着老式胶卷相机（莱卡、海鸥）、镜头盒，周围摆放着旧照片（带泛黄边）；上面摆放多样物件：复古手电筒、装胶卷的铁皮盒子、陶瓷小猫摆件、带签名的照片、木质相框；背景是浅灰格子图案的墙面，挂满摄影作品（街景、人像主题）；地面是浅棕条纹花纹地毯，周围环绕绿萝、虎皮兰。整体融合民间艺术的稚拙感与当代潮流活力，通过明快的色彩碰撞和细节满满的物件组合，营造充满复古摄影记忆的室内视觉体验。3:4",
  "在一个宁静的冬日场景中，广阔的雪地覆盖着整个画面，呈现出极简的白色世界。一位孤独的行人或滑雪者正缓缓穿越雪地，身影细小却清晰，在雪地上投下长长的影子。画面中段排列着几棵光秃的树木，树干细长，枝条稀疏，与洁白的背景形成鲜明对比。远处是起伏的雪丘和稀疏的树林，营造出深度感与空间层次。整个画面采用单色调处理，突出静谧、孤独与自然的纯粹之美，充满诗意与哲思",
  "金政基风格超写实细节与超现实城市空间融合，完美透视关系，动态构图。画面布满大量赛博朋克风格的人物、机械与复古日常物件科幻与复古未来主义混合，混乱中暗藏秩序。多色彩。硬朗精准的线条艺术，极繁主义构图，神秘氛围，不对称布局。细节密集，高品质细节表现，超高清分辨率，笔触清晰，强烈光影对比。\n4:3",
  "文字创意排版海报，海报中的微小密集的彩字跟随富兰克林布斯的密集排线，构成以文字为载体的胡安米罗风格拼贴海报，抽象的几束花朵形象，强烈的肌理感与层次分明的文字堆积，杰作。3:4",
  "创意插画风格，画面为一组电脑键盘按键，其中“Esc”键被设计成一个迷你游泳池，池中漂浮着一位穿红色泳衣的小人，仰躺在水面上休息；周围按键包括“^”、“!”、“1”、“F1”等标准键盘符号，背景为灰色，整体构图幽默巧妙，将日常科技元素与轻松场景融合，表达逃离工作、放松心情的隐喻主题，风格现代、富有想象力，适合数字文化或创意概念插图。",
  "背景纯白，一个真实的精美的小青花瓷花瓶，从瓶口向上喷出流动的水墨占满画面的三分之二，水墨层次分明里面是莫奈睡莲，抽象艺术，视觉冲击力，层次丰富，高噪点，颗粒感，晕染，氛围感染力，动态美学，超现实，极致细节，高级感，极简，插画风格。",
  "原始派艺术，亨利·卢梭艺术风格，工笔般细致线条。明亮复古装饰风格的房间内，高大的深木书架摆满书籍。房间布置大量绿植盆栽，热带植物、龟背竹、兰花、郁金香盛开。华丽天鹅绒沙发与雕花书桌形成视觉中心，书桌上停着一只蓝灰色鹦鹉。整体色彩更改为孔雀蓝、赭石橙与象牙白对比，色彩鲜活饱满。氛围优雅浪漫，细节繁复入微，对比强烈，高清细节，质感丰富。3:4",
  "手绘风格的邀请卡，色调柔和清新，构图简洁明了。主标题为“BRUNCH & SLEEPOVER”，字体为蓝紫色钢笔字，纤细的手写体，前中景有钢笔画的酒瓶、酒杯、牛奶盒、咖啡杯、煎饼、花瓶等元素，物体都很小，物体画得歪歪扭扭，不规则，位于画面下半部分。米黄色纸张背景。钢笔画的方框框柱画面，笔触松弛感。3:4",
] as const;

const INSPIRATION_COLUMNS: readonly (readonly InspirationItem[])[] = [
  [
    {
      order: 1,
      source: require("../../assets/ai-creation-inspiration/inspiration-01.png"),
      height: 294,
    },
    {
      order: 4,
      source: require("../../assets/ai-creation-inspiration/inspiration-04.png"),
      height: 392,
    },
    {
      order: 7,
      source: require("../../assets/ai-creation-inspiration/inspiration-07.png"),
      height: 524,
    },
    {
      order: 12,
      source: require("../../assets/ai-creation-inspiration/inspiration-12.png"),
      height: 392,
    },
    {
      order: 15,
      source: require("../../assets/ai-creation-inspiration/inspiration-15.png"),
      height: 392,
    },
    {
      order: 18,
      source: require("../../assets/ai-creation-inspiration/inspiration-18.png"),
      height: 392,
    },
    {
      order: 21,
      source: require("../../assets/ai-creation-inspiration/inspiration-21.png"),
      height: 392,
    },
    {
      order: 24,
      source: require("../../assets/ai-creation-inspiration/inspiration-24.png"),
      height: 524,
    },
    {
      order: 27,
      source: require("../../assets/ai-creation-inspiration/inspiration-27.png"),
      height: 294,
    },
    {
      order: 30,
      source: require("../../assets/ai-creation-inspiration/inspiration-30.png"),
      height: 392,
    },
    {
      order: 33,
      source: require("../../assets/ai-creation-inspiration/inspiration-33.png"),
      height: 442,
    },
    {
      order: 35,
      source: require("../../assets/ai-creation-inspiration/inspiration-35.png"),
      height: 392,
    },
    {
      order: 38,
      source: require("../../assets/ai-creation-inspiration/inspiration-38.png"),
      height: 392,
    },
    {
      order: 41,
      source: require("../../assets/ai-creation-inspiration/inspiration-41.png"),
      height: 392,
    },
    {
      order: 44,
      source: require("../../assets/ai-creation-inspiration/inspiration-44.png"),
      height: 392,
    },
    {
      order: 47,
      source: require("../../assets/ai-creation-inspiration/inspiration-47.png"),
      height: 523,
    },
    {
      order: 51,
      source: require("../../assets/ai-creation-inspiration/inspiration-51.png"),
      height: 392,
    },
    {
      order: 54,
      source: require("../../assets/ai-creation-inspiration/inspiration-54.png"),
      height: 392,
    },
    {
      order: 56,
      source: require("../../assets/ai-creation-inspiration/inspiration-56.png"),
      height: 392,
    },
    {
      order: 60,
      source: require("../../assets/ai-creation-inspiration/inspiration-60.png"),
      height: 392,
    },
    {
      order: 63,
      source: require("../../assets/ai-creation-inspiration/inspiration-63.png"),
      height: 196,
    },
    {
      order: 65,
      source: require("../../assets/ai-creation-inspiration/inspiration-65.png"),
      height: 442,
    },
    {
      order: 68,
      source: require("../../assets/ai-creation-inspiration/inspiration-68.png"),
      height: 165,
    },
    {
      order: 70,
      source: require("../../assets/ai-creation-inspiration/inspiration-70.png"),
      height: 442,
    },
    {
      order: 73,
      source: require("../../assets/ai-creation-inspiration/inspiration-73.png"),
      height: 524,
    },
    {
      order: 77,
      source: require("../../assets/ai-creation-inspiration/inspiration-77.png"),
      height: 442,
    },
    {
      order: 81,
      source: require("../../assets/ai-creation-inspiration/inspiration-81.png"),
      height: 392,
    },
    {
      order: 84,
      source: require("../../assets/ai-creation-inspiration/inspiration-84.png"),
      height: 222,
    },
    {
      order: 86,
      source: require("../../assets/ai-creation-inspiration/inspiration-86.png"),
      height: 392,
    },
    {
      order: 89,
      source: require("../../assets/ai-creation-inspiration/inspiration-89.png"),
      height: 392,
    },
    {
      order: 92,
      source: require("../../assets/ai-creation-inspiration/inspiration-92.png"),
      height: 392,
    },
    {
      order: 95,
      source: require("../../assets/ai-creation-inspiration/inspiration-95.png"),
      height: 221,
    },
    {
      order: 98,
      source: require("../../assets/ai-creation-inspiration/inspiration-98.png"),
      height: 392,
    },
  ],
  [
    {
      order: 2,
      source: require("../../assets/ai-creation-inspiration/inspiration-02.png"),
      height: 392,
    },
    {
      order: 5,
      source: require("../../assets/ai-creation-inspiration/inspiration-05.png"),
      height: 392,
    },
    {
      order: 8,
      source: require("../../assets/ai-creation-inspiration/inspiration-08.png"),
      height: 392,
    },
    {
      order: 10,
      source: require("../../assets/ai-creation-inspiration/inspiration-10.png"),
      height: 392,
    },
    {
      order: 13,
      source: require("../../assets/ai-creation-inspiration/inspiration-13.png"),
      height: 392,
    },
    {
      order: 16,
      source: require("../../assets/ai-creation-inspiration/inspiration-16.png"),
      height: 392,
    },
    {
      order: 19,
      source: require("../../assets/ai-creation-inspiration/inspiration-19.png"),
      height: 392,
    },
    {
      order: 22,
      source: require("../../assets/ai-creation-inspiration/inspiration-22.png"),
      height: 392,
    },
    {
      order: 25,
      source: require("../../assets/ai-creation-inspiration/inspiration-25.png"),
      height: 294,
    },
    {
      order: 28,
      source: require("../../assets/ai-creation-inspiration/inspiration-28.png"),
      height: 392,
    },
    {
      order: 31,
      source: require("../../assets/ai-creation-inspiration/inspiration-31.png"),
      height: 524,
    },
    {
      order: 34,
      source: require("../../assets/ai-creation-inspiration/inspiration-34.png"),
      height: 392,
    },
    {
      order: 37,
      source: require("../../assets/ai-creation-inspiration/inspiration-37.png"),
      height: 392,
    },
    {
      order: 40,
      source: require("../../assets/ai-creation-inspiration/inspiration-40.png"),
      height: 392,
    },
    {
      order: 43,
      source: require("../../assets/ai-creation-inspiration/inspiration-43.png"),
      height: 392,
    },
    {
      order: 46,
      source: require("../../assets/ai-creation-inspiration/inspiration-46.png"),
      height: 392,
    },
    {
      order: 49,
      source: require("../../assets/ai-creation-inspiration/inspiration-49.png"),
      height: 523,
    },
    {
      order: 53,
      source: require("../../assets/ai-creation-inspiration/inspiration-53.png"),
      height: 392,
    },
    {
      order: 55,
      source: require("../../assets/ai-creation-inspiration/inspiration-55.png"),
      height: 392,
    },
    {
      order: 58,
      source: require("../../assets/ai-creation-inspiration/inspiration-58.png"),
      height: 392,
    },
    {
      order: 61,
      source: require("../../assets/ai-creation-inspiration/inspiration-61.png"),
      height: 165,
    },
    {
      order: 64,
      source: require("../../assets/ai-creation-inspiration/inspiration-64.png"),
      height: 442,
    },
    {
      order: 67,
      source: require("../../assets/ai-creation-inspiration/inspiration-67.png"),
      height: 392,
    },
    {
      order: 71,
      source: require("../../assets/ai-creation-inspiration/inspiration-71.png"),
      height: 392,
    },
    {
      order: 74,
      source: require("../../assets/ai-creation-inspiration/inspiration-74.png"),
      height: 442,
    },
    {
      order: 76,
      source: require("../../assets/ai-creation-inspiration/inspiration-76.png"),
      height: 294,
    },
    {
      order: 79,
      source: require("../../assets/ai-creation-inspiration/inspiration-79.png"),
      height: 165,
    },
    {
      order: 80,
      source: require("../../assets/ai-creation-inspiration/inspiration-80.png"),
      height: 392,
    },
    {
      order: 83,
      source: require("../../assets/ai-creation-inspiration/inspiration-83.png"),
      height: 392,
    },
    {
      order: 87,
      source: require("../../assets/ai-creation-inspiration/inspiration-87.png"),
      height: 392,
    },
    {
      order: 91,
      source: require("../../assets/ai-creation-inspiration/inspiration-91.png"),
      height: 392,
    },
    {
      order: 94,
      source: require("../../assets/ai-creation-inspiration/inspiration-94.png"),
      height: 392,
    },
    {
      order: 97,
      source: require("../../assets/ai-creation-inspiration/inspiration-97.png"),
      height: 392,
    },
    {
      order: 100,
      source: require("../../assets/ai-creation-inspiration/inspiration-100.png"),
      height: 392,
    },
  ],
  [
    {
      order: 3,
      source: require("../../assets/ai-creation-inspiration/inspiration-03.png"),
      height: 392,
    },
    {
      order: 6,
      source: require("../../assets/ai-creation-inspiration/inspiration-06.png"),
      height: 392,
    },
    {
      order: 9,
      source: require("../../assets/ai-creation-inspiration/inspiration-09.png"),
      height: 392,
    },
    {
      order: 11,
      source: require("../../assets/ai-creation-inspiration/inspiration-11.png"),
      height: 392,
    },
    {
      order: 14,
      source: require("../../assets/ai-creation-inspiration/inspiration-14.png"),
      height: 392,
    },
    {
      order: 17,
      source: require("../../assets/ai-creation-inspiration/inspiration-17.png"),
      height: 392,
    },
    {
      order: 20,
      source: require("../../assets/ai-creation-inspiration/inspiration-20.png"),
      height: 392,
    },
    {
      order: 23,
      source: require("../../assets/ai-creation-inspiration/inspiration-23.png"),
      height: 392,
    },
    {
      order: 26,
      source: require("../../assets/ai-creation-inspiration/inspiration-26.png"),
      height: 392,
    },
    {
      order: 29,
      source: require("../../assets/ai-creation-inspiration/inspiration-29.png"),
      height: 392,
    },
    {
      order: 32,
      source: require("../../assets/ai-creation-inspiration/inspiration-32.png"),
      height: 523,
    },
    {
      order: 36,
      source: require("../../assets/ai-creation-inspiration/inspiration-36.png"),
      height: 392,
    },
    {
      order: 39,
      source: require("../../assets/ai-creation-inspiration/inspiration-39.png"),
      height: 392,
    },
    {
      order: 42,
      source: require("../../assets/ai-creation-inspiration/inspiration-42.png"),
      height: 392,
    },
    {
      order: 45,
      source: require("../../assets/ai-creation-inspiration/inspiration-45.png"),
      height: 392,
    },
    {
      order: 48,
      source: require("../../assets/ai-creation-inspiration/inspiration-48.png"),
      height: 392,
    },
    {
      order: 50,
      source: require("../../assets/ai-creation-inspiration/inspiration-50.png"),
      height: 392,
    },
    {
      order: 52,
      source: require("../../assets/ai-creation-inspiration/inspiration-52.png"),
      height: 524,
    },
    {
      order: 57,
      source: require("../../assets/ai-creation-inspiration/inspiration-57.png"),
      height: 294,
    },
    {
      order: 59,
      source: require("../../assets/ai-creation-inspiration/inspiration-59.png"),
      height: 392,
    },
    {
      order: 62,
      source: require("../../assets/ai-creation-inspiration/inspiration-62.png"),
      height: 392,
    },
    {
      order: 66,
      source: require("../../assets/ai-creation-inspiration/inspiration-66.png"),
      height: 392,
    },
    {
      order: 69,
      source: require("../../assets/ai-creation-inspiration/inspiration-69.png"),
      height: 442,
    },
    {
      order: 72,
      source: require("../../assets/ai-creation-inspiration/inspiration-72.png"),
      height: 523,
    },
    {
      order: 75,
      source: require("../../assets/ai-creation-inspiration/inspiration-75.png"),
      height: 165,
    },
    {
      order: 78,
      source: require("../../assets/ai-creation-inspiration/inspiration-78.png"),
      height: 442,
    },
    {
      order: 82,
      source: require("../../assets/ai-creation-inspiration/inspiration-82.png"),
      height: 442,
    },
    {
      order: 85,
      source: require("../../assets/ai-creation-inspiration/inspiration-85.png"),
      height: 392,
    },
    {
      order: 88,
      source: require("../../assets/ai-creation-inspiration/inspiration-88.png"),
      height: 165,
    },
    {
      order: 90,
      source: require("../../assets/ai-creation-inspiration/inspiration-90.png"),
      height: 392,
    },
    {
      order: 93,
      source: require("../../assets/ai-creation-inspiration/inspiration-93.png"),
      height: 392,
    },
    {
      order: 96,
      source: require("../../assets/ai-creation-inspiration/inspiration-96.png"),
      height: 392,
    },
    {
      order: 99,
      source: require("../../assets/ai-creation-inspiration/inspiration-99.png"),
      height: 392,
    },
  ],
] as const;

const INSPIRATION_ITEM_COUNT = INSPIRATION_COLUMNS.reduce(
  (total, column) => total + column.length,
  0,
);
const INSPIRATION_ITEMS = [...INSPIRATION_COLUMNS.flat()].sort((a, b) => a.order - b.order);

function ensureAiCreationTitleGradientKeyframes() {
  if (!isWeb || typeof document === "undefined") {
    return;
  }
  const existing = document.getElementById(AI_CREATION_TITLE_GRADIENT_KEYFRAME_ID);
  if (existing) {
    if (existing.textContent !== AI_CREATION_TITLE_GRADIENT_KEYFRAME_CSS) {
      existing.textContent = AI_CREATION_TITLE_GRADIENT_KEYFRAME_CSS;
    }
    return;
  }
  const styleElement = document.createElement("style");
  styleElement.id = AI_CREATION_TITLE_GRADIENT_KEYFRAME_ID;
  styleElement.textContent = AI_CREATION_TITLE_GRADIENT_KEYFRAME_CSS;
  document.head.appendChild(styleElement);
}

function usesWorkspaceFileReferences(mode: CreationMode): boolean {
  return mode === "slides" || mode === "pdf" || mode === "word" || mode === "spreadsheet";
}

function getAiCreationIntentForMode(mode: CreationMode): AiCreationIntent {
  if (mode === "slides") {
    return "ppt_creation";
  }
  if (mode === "edit") {
    return "image_edit";
  }
  if (mode === "pdf") {
    return "pdf_creation";
  }
  if (mode === "word") {
    return "word_creation";
  }
  if (mode === "spreadsheet") {
    return "spreadsheet_creation";
  }
  return "imagegen";
}

function attachmentMetadataToComposerAttachment(
  metadata: PreviewableAttachmentMetadata,
): UserComposerAttachment {
  return metadata.mimeType.toLowerCase().startsWith("image/")
    ? { kind: "image", metadata }
    : { kind: "file", metadata };
}

function composerAttachmentToMetadata(attachment: ComposerAttachment): AttachmentMetadata | null {
  if (attachment.kind === "image" || attachment.kind === "file") {
    return attachment.metadata;
  }
  return null;
}

function isComposerImageAttachment(
  attachment: UserComposerAttachment,
): attachment is Extract<UserComposerAttachment, { kind: "image" }> {
  return attachment.kind === "image";
}

function isPersistedAssistantWorkspaceImageReference(attachment: UserComposerAttachment): boolean {
  return (
    attachment.kind === "image" && attachment.metadata.id.startsWith("assistant_workspace_image_")
  );
}

function usesAspectRatio(mode: CreationMode): boolean {
  return mode === "image" || mode === "edit" || mode === "slides";
}

function getInspirationPrompt(order: number): string {
  return INSPIRATION_PROMPTS[order - 1] ?? "";
}

function inferAspectRatioFromPrompt(prompt: string): AspectRatio | null {
  const match = prompt.match(/(?:比例\s*)?(1:1|2:3|3:4|4:3|9:16|16:9)/);
  if (!match) return null;
  return match[1] as AspectRatio;
}

function getPromptPlaceholderKey(mode: Exclude<CreationMode, "edit">): TranslationKey {
  if (mode === "slides") {
    return "aiCreation.prompt.slidesPlaceholder";
  }
  if (mode === "pdf") {
    return "aiCreation.prompt.pdfPlaceholder";
  }
  if (mode === "word") {
    return "aiCreation.prompt.wordPlaceholder";
  }
  if (mode === "spreadsheet") {
    return "aiCreation.prompt.spreadsheetPlaceholder";
  }
  return "aiCreation.prompt.imagePlaceholder";
}

export function AiCreationScreen({
  serverId,
  restoreEditSource = false,
}: {
  serverId: string;
  restoreEditSource?: boolean;
}) {
  const router = useRouter();
  const { theme } = useUnistyles();
  const { locale, t } = useI18n();
  const toast = useToast();
  const openBillingUpgrade = useBillingUpgradeModalStore((state) => state.open);
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const hosts = useHosts();
  const toggleMobileAgentList = usePanelStore((state) => state.toggleMobileAgentList);
  const toggleDesktopAgentList = usePanelStore((state) => state.toggleDesktopAgentList);
  const openAccountLogin = useAccountLoginModalStore((state) => state.open);
  const accountSession = useAccountWorkspaceMetadata(serverId);
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const setAgents = useSessionStore((state) => state.setAgents);
  const setHasHydratedWorkspaces = useSessionStore((state) => state.setHasHydratedWorkspaces);
  const appendOptimisticUserMessageToAgentStream = useSessionStore(
    (state) => state.appendOptimisticUserMessageToAgentStream,
  );
  const supportsConversationReplay = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.conversationReplay === true,
  );
  const { pickImages } = useImageAttachmentPicker();
  const { pickFiles } = useFileAttachmentPicker();
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const selectedWorkspaceId =
    lastWorkspaceSelection?.serverId === serverId ? lastWorkspaceSelection.workspaceId : null;
  const selectedWorkspace = useWorkspaceFields(serverId, selectedWorkspaceId, (workspace) => ({
    id: workspace.id,
    workspaceDirectory: workspace.workspaceDirectory,
  }));
  const recommendedProjectPaths = useRecommendedProjectPaths(serverId);
  const creationCwd = selectedWorkspace?.workspaceDirectory ?? recommendedProjectPaths[0] ?? "";
  const composerInitialValues = useMemo(
    () => ({
      provider: "codex" as const,
      ...(creationCwd ? { workingDir: creationCwd } : {}),
    }),
    [creationCwd],
  );
  const [initialEditState] = useState(() => takeInitialAiCreationEditState(restoreEditSource));
  const [mode, setMode] = useState<CreationMode>(initialEditState.mode);
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [style, setStyle] = useState<VisualStyle>("auto");
  const draftKey = useMemo(
    () =>
      initialEditState.mode === "edit" && initialEditState.sourceAgentId
        ? `ai-creation-edit:${serverId}:${initialEditState.sourceAgentId}:${initialEditState.references[0]?.id ?? "source"}`
        : `ai-creation:${serverId}`,
    [initialEditState.mode, initialEditState.references, initialEditState.sourceAgentId, serverId],
  );
  const draft = useAgentInputDraft({
    draftKey,
    composer: {
      initialServerId: serverId,
      isVisible: true,
      onlineServerIds: isConnected ? [serverId] : [],
      initialValues: composerInitialValues,
      lockedWorkingDir: creationCwd || undefined,
    },
  });
  const initialReferenceAttachments = useMemo(
    () => initialEditState.references.map(attachmentMetadataToComposerAttachment),
    [initialEditState.references],
  );
  const didSeedInitialReferencesRef = useRef(false);
  const referenceAttachments = draft.attachments;
  const setReferenceAttachments = draft.setAttachments;
  const clearDraft = draft.clear;
  const references = useMemo(
    () =>
      referenceAttachments.flatMap((attachment) => {
        const metadata = composerAttachmentToMetadata(attachment);
        return metadata ? [metadata] : [];
      }),
    [referenceAttachments],
  );
  const [conversationEditImages, setConversationEditImages] = useState<
    WorkspaceMaterializeAttachment[]
  >([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [recordConversation, setRecordConversation] = useState(false);
  const [selectionStrokes, setSelectionStrokes] = useState<SelectionStroke[]>([]);
  const [redoSelectionStrokes, setRedoSelectionStrokes] = useState<SelectionStroke[]>([]);
  const [selectionBrushSize, setSelectionBrushSize] = useState(SELECTION_BRUSH_SIZE_DEFAULT);
  const [selectionColor, setSelectionColor] = useState(SELECTION_DEFAULT_STROKE_COLOR);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCopyingImage, setIsCopyingImage] = useState(false);
  const [isDownloadingImage, setIsDownloadingImage] = useState(false);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const [visibleInspirationCount, setVisibleInspirationCount] = useState(INITIAL_INSPIRATION_COUNT);
  const editImage = mode === "edit" ? (references[0] ?? null) : null;
  const editTargetAgentId =
    mode === "edit" && initialEditState.sourceServerId === serverId
      ? initialEditState.sourceAgentId
      : null;
  const sourceEditAgentCwd = useSessionStore((state) =>
    editTargetAgentId ? state.sessions[serverId]?.agents.get(editTargetAgentId)?.cwd : undefined,
  );
  const prompt = draft.text;
  const setPrompt = draft.setText;
  const [promptInputHeight, setPromptInputHeight] = useState(AI_CREATION_PROMPT_MIN_HEIGHT);
  const composerState = draft.composerState;
  const selectedProvider = composerState?.selectedProvider ?? "";
  const selectedModel = composerState?.selectedModel ?? "";
  const isPromptInputScrollable = promptInputHeight >= AI_CREATION_PROMPT_MAX_HEIGHT;
  const promptInputStyle = useMemo(
    () => [
      styles.promptInput,
      {
        height: promptInputHeight,
        ...(isWeb ? ({ overflowY: isPromptInputScrollable ? "auto" : "hidden" } as object) : {}),
      },
    ],
    [isPromptInputScrollable, promptInputHeight],
  );
  const syncPromptInputHeight = useCallback((contentHeight: number) => {
    const nextHeight = Math.max(
      AI_CREATION_PROMPT_MIN_HEIGHT,
      Math.min(AI_CREATION_PROMPT_MAX_HEIGHT, contentHeight),
    );
    setPromptInputHeight((current) => (Math.abs(current - nextHeight) < 1 ? current : nextHeight));
  }, []);
  const handleChangePrompt = useCallback(
    (nextPrompt: string) => {
      setPrompt(nextPrompt);
      const lineCount = Math.max(1, nextPrompt.split(/\r\n|\r|\n/).length);
      syncPromptInputHeight(lineCount * AI_CREATION_PROMPT_LINE_HEIGHT);
    },
    [syncPromptInputHeight, setPrompt],
  );
  const handlePromptContentSizeChange = useCallback(
    (event: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      syncPromptInputHeight(event.nativeEvent.contentSize.height);
    },
    [syncPromptInputHeight],
  );
  useEffect(() => {
    if (didSeedInitialReferencesRef.current || !draft.isHydrated) {
      return;
    }
    didSeedInitialReferencesRef.current = true;
    if (initialReferenceAttachments.length === 0) {
      return;
    }
    if (initialEditState.mode === "edit" || referenceAttachments.length === 0) {
      setReferenceAttachments(initialReferenceAttachments);
    }
  }, [
    draft.isHydrated,
    initialEditState.mode,
    initialReferenceAttachments,
    referenceAttachments.length,
    setReferenceAttachments,
  ]);
  useEffect(() => {
    if (!draft.isHydrated || initialEditState.mode === "edit" || prompt.trim().length > 0) {
      return;
    }
    if (referenceAttachments.length === 0) {
      return;
    }
    if (!referenceAttachments.every(isPersistedAssistantWorkspaceImageReference)) {
      return;
    }
    clearDraft("abandoned");
  }, [clearDraft, draft.isHydrated, initialEditState.mode, prompt, referenceAttachments]);
  const subtitleText = t("aiCreation.subtitle");
  const [typedSubtitleLength, setTypedSubtitleLength] = useState(0);
  useEffect(() => {
    setTypedSubtitleLength(0);
  }, [subtitleText]);
  useEffect(() => {
    if (typedSubtitleLength >= subtitleText.length) {
      return;
    }
    const timeout = setTimeout(() => {
      setTypedSubtitleLength((current) => Math.min(subtitleText.length, current + 1));
    }, SUBTITLE_TYPEWRITER_STEP_MS);
    return () => clearTimeout(timeout);
  }, [subtitleText, typedSubtitleLength]);
  const typedSubtitle = subtitleText.slice(0, typedSubtitleLength);
  const isSubtitleTyping = typedSubtitleLength < subtitleText.length;
  useEffect(() => {
    ensureAiCreationTitleGradientKeyframes();
  }, []);
  const handleToggleSidebar = useCallback(() => {
    if (isCompact) {
      toggleMobileAgentList();
      return;
    }
    toggleDesktopAgentList();
  }, [isCompact, toggleDesktopAgentList, toggleMobileAgentList]);
  const handleNewSession = useCallback(() => {
    router.push(buildHostHomeRoute(serverId));
  }, [router, serverId]);
  const conversationEditTitle = getConversationEditTitle(initialEditState.references[0]);
  const selectionPreviewUri = initialEditState.previewUri ?? undefined;
  const selectionImageSource = initialEditState.imageSource ?? undefined;
  const modeOptions = useMemo(
    () => [
      { value: "image" as const, label: t("aiCreation.mode.image") },
      { value: "slides" as const, label: t("aiCreation.mode.slides") },
      { value: "pdf" as const, label: t("aiCreation.mode.pdf") },
      { value: "word" as const, label: t("aiCreation.mode.word") },
      { value: "spreadsheet" as const, label: t("aiCreation.mode.spreadsheet") },
    ],
    [t],
  );

  const handleSelectModel = useCallback(
    (provider: AgentProvider, modelId: string) => {
      composerState?.setProviderAndModelFromUser(provider, modelId);
    },
    [composerState],
  );

  const handlePickReference = useCallback(async () => {
    if (usesWorkspaceFileReferences(mode)) {
      const files = await pickFiles();
      if (files.length === 0) return;
      setReferenceAttachments((current) => [
        ...current,
        ...files.map((metadata) => ({ kind: "file" as const, metadata })),
      ]);
      return;
    }

    const images = await pickAndPersistImages({
      pickImages,
      persister: {
        persistFromBlob: ({ blob, mimeType, fileName }) =>
          persistAttachmentFromBlob({ blob, mimeType, fileName }),
        persistFromFileUri: ({ uri, mimeType, fileName }) =>
          persistAttachmentFromFileUri({ uri, mimeType, fileName }),
      },
    });
    if (images.length === 0) return;
    setReferenceAttachments((current) => [
      ...current,
      ...images.map((metadata) => ({ kind: "image" as const, metadata })),
    ]);
  }, [mode, pickFiles, pickImages]);

  const handlePickEditImage = useCallback(async () => {
    const images = await pickAndPersistImages({
      pickImages,
      persister: {
        persistFromBlob: ({ blob, mimeType, fileName }) =>
          persistAttachmentFromBlob({ blob, mimeType, fileName }),
        persistFromFileUri: ({ uri, mimeType, fileName }) =>
          persistAttachmentFromFileUri({ uri, mimeType, fileName }),
      },
    });
    const image = images[0];
    if (!image) return;
    setReferenceAttachments([{ kind: "image", metadata: image }]);
    setSelectionStrokes([]);
    setRedoSelectionStrokes([]);
    setMode("edit");
  }, [pickImages]);

  const handlePickConversationEditImage = useCallback(async () => {
    const picked = await pickImages();
    const images = picked ? await persistPickedImagesWithFallbackPreviewUrl(picked) : [];
    if (images.length === 0) return;
    setConversationEditImages((current) => [...current, ...images]);
  }, [pickImages]);

  const handleRemoveReference = useCallback((id: string) => {
    setReferenceAttachments((current) =>
      current.filter((attachment) => composerAttachmentToMetadata(attachment)?.id !== id),
    );
  }, []);

  const handleRemoveConversationEditImage = useCallback((id: string) => {
    setConversationEditImages((current) => current.filter((image) => image.id !== id));
  }, []);

  const handleChangeMode = useCallback((nextMode: CreationMode) => {
    if (nextMode === "slides") {
      setRatio("16:9");
    }
    if (nextMode !== "edit") {
      clearAiCreationEditSource();
      setSelectionMode(false);
      setSelectionStrokes([]);
      setRedoSelectionStrokes([]);
      setConversationEditImages([]);
    }
    if (nextMode === "image") {
      setReferenceAttachments((current) => current.filter(isComposerImageAttachment));
    }
    setMode(nextMode);
  }, []);

  const handleUseInspirationPrompt = useCallback(
    (nextPrompt: string) => {
      setMode("image");
      setPrompt(nextPrompt);
      const nextRatio = inferAspectRatioFromPrompt(nextPrompt);
      if (nextRatio) {
        setRatio(nextRatio);
      }
    },
    [setPrompt],
  );

  const handleInspirationScroll = useCallback(
    ({
      nativeEvent,
    }: {
      nativeEvent: {
        contentOffset: { y: number };
        contentSize: { height: number };
        layoutMeasurement: { height: number };
      };
    }) => {
      const distanceFromBottom =
        nativeEvent.contentSize.height -
        nativeEvent.layoutMeasurement.height -
        nativeEvent.contentOffset.y;
      if (distanceFromBottom > 420) {
        return;
      }
      setVisibleInspirationCount((current) =>
        Math.min(INSPIRATION_ITEM_COUNT, current + INSPIRATION_PAGE_SIZE),
      );
    },
    [],
  );

  const handleToggleSelectionMode = useCallback(() => {
    setMode("edit");
    setSelectionMode((current) => !current);
  }, []);

  const handleChangeSelectionStrokes = useCallback((nextStrokes: SelectionStroke[]) => {
    setSelectionStrokes(nextStrokes);
    setRedoSelectionStrokes([]);
  }, []);

  const handleUndoSelection = useCallback(() => {
    setSelectionStrokes((current) => {
      const lastStroke = current[current.length - 1];
      if (!lastStroke) return current;
      setRedoSelectionStrokes((redoCurrent) => [lastStroke, ...redoCurrent]);
      return current.slice(0, -1);
    });
  }, []);

  const handleRedoSelection = useCallback(() => {
    setRedoSelectionStrokes((current) => {
      const [nextStroke, ...rest] = current;
      if (!nextStroke) return current;
      setSelectionStrokes((strokesCurrent) => [...strokesCurrent, nextStroke]);
      return rest;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectionStrokes([]);
    setRedoSelectionStrokes([]);
  }, []);
  const handleCloseConversationEdit = useCallback(() => {
    if (editTargetAgentId) {
      router.push(buildHostAgentDetailRoute(serverId, editTargetAgentId));
      return;
    }
    router.back();
  }, [editTargetAgentId, router, serverId]);
  const handleCopyEditImage = useCallback(async () => {
    if (!editImage) {
      toast.error(t("aiCreation.error.noImageToCopy"));
      return;
    }
    setIsCopyingImage(true);
    try {
      const encoded = await encodeAttachmentsForSend([editImage]);
      const imageData = encoded?.[0]?.data;
      if (!imageData) {
        throw new Error(t("aiCreation.error.imageDataUnavailable"));
      }
      await Clipboard.setImageAsync(imageData);
      toast.show(t("aiCreation.toast.imageCopied"), { variant: "success" });
    } catch (error) {
      console.error("[AiCreation] Failed to copy image", error);
      toast.error(error instanceof Error ? error.message : t("aiCreation.error.copyImage"));
    } finally {
      setIsCopyingImage(false);
    }
  }, [editImage, t, toast]);
  const handleDownloadEditImage = useCallback(async () => {
    if (!editImage) {
      toast.error(t("aiCreation.error.noImageToDownload"));
      return;
    }
    setIsDownloadingImage(true);
    try {
      const encoded = await encodeAttachmentsForSend([editImage]);
      const imageData = encoded?.[0]?.data;
      if (!imageData) {
        throw new Error(t("aiCreation.error.imageDataUnavailable"));
      }
      const fileName = resolveDownloadFileName(editImage);
      if (isWeb) {
        triggerImageDownload({
          data: imageData,
          mimeType: editImage.mimeType,
          fileName,
        });
      } else {
        if (!FileSystem.cacheDirectory) {
          throw new Error(t("aiCreation.error.downloadCacheUnavailable"));
        }
        const targetUri = `${FileSystem.cacheDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(targetUri, imageData, {
          encoding: FileSystem.EncodingType.Base64,
        });
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error(t("aiCreation.error.sharingUnavailable"));
        }
        const shareOptions = {
          mimeType: editImage.mimeType,
          dialogTitle: t("aiCreation.share.saveImage"),
          ...(editImage.mimeType === "image/png" ? { UTI: "public.png" } : {}),
        };
        await Sharing.shareAsync(targetUri, {
          ...shareOptions,
        });
      }
      toast.show(t("aiCreation.toast.imageDownloaded"), { variant: "success" });
    } catch (error) {
      console.error("[AiCreation] Failed to download image", error);
      toast.error(error instanceof Error ? error.message : t("aiCreation.error.downloadImage"));
    } finally {
      setIsDownloadingImage(false);
    }
  }, [editImage, t, toast]);

  const canSubmit =
    prompt.trim().length > 0 &&
    Boolean(composerState) &&
    (editTargetAgentId ? Boolean(client) && isConnected : true) &&
    (mode !== "edit" || Boolean(editImage));

  const handleCreate = useCallback(async () => {
    if (!composerState) return;
    if (editTargetAgentId && !client) return;
    const provider = composerState.selectedProvider;
    if (!provider && !editTargetAgentId) {
      toast.error(t("aiCreation.error.selectCodexModel"));
      return;
    }
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    setIsSubmitting(true);
    try {
      const title = buildAiCreationTitle({ mode, prompt: trimmedPrompt });
      const clientMessageId = generateMessageId();
      let submittedReferences: UserMessageImageAttachment[] = references;
      const submittedReferenceAttachments = referenceAttachments;
      const submittedEditImage = editImage;
      const selectionGuideDimensions = await resolveSelectionGuideDimensions({
        mode,
        selectionStrokes,
        selectionPreviewUri,
      });
      const existingEditSourcePath =
        mode === "edit" && editTargetAgentId
          ? resolveWorkspaceRelativeImagePath(selectionImageSource)
          : null;
      const { images, hasSelectionGuide, selectionGuide } = await encodeAiCreationImagesForSubmit({
        mode,
        client,
        references,
        conversationEditImages: editTargetAgentId ? conversationEditImages : [],
        includeImagePayload: !editTargetAgentId,
        selectionStrokes,
        selectionGuideDimensions,
        selectionPreviewUri,
      });
      let editFileInputs: WorkspaceMaterializeAttachment[] = [];
      if (mode === "edit" && editTargetAgentId) {
        editFileInputs = buildConversationImageEditMaterializeInputs({
          sourceImage: submittedEditImage,
          sourceFallbackPreviewUrl: selectionPreviewUri,
          includeSourceImage: !existingEditSourcePath,
          selectionGuide,
          extraImages: conversationEditImages,
        });
      } else if (mode === "edit" && selectionGuide) {
        editFileInputs = buildGuidedImageEditMaterializeInputs({
          sourceImage: submittedEditImage,
          sourceFallbackPreviewUrl: selectionPreviewUri,
          includeSourceImage: true,
          selectionGuide,
          extraImages: [],
        });
      }
      const existingEditSourceAttachment = existingEditSourcePath
        ? buildWorkspacePathAttachment({
            title: "ai-edit-source.png",
            mimeType: submittedEditImage?.mimeType ?? "image/png",
            path: existingEditSourcePath,
          })
        : null;
      const initialPrompt = buildAiCreationPrompt({
        messageId: clientMessageId,
        mode,
        prompt: trimmedPrompt,
        defaultLocale: locale,
        ratio,
        style,
        referenceCount: references.length,
        extraImageCount: editTargetAgentId ? conversationEditImages.length : 0,
        hasSelectionGuide,
      });
      if (editTargetAgentId) {
        const userMessageText = initialPrompt;
        const selectionImageForDisplay =
          hasSelectionGuide && submittedEditImage ? submittedEditImage : undefined;
        const hasSelectionReference = Boolean(selectionPreviewUri && selectionImageForDisplay);
        const localOptimisticImages = buildEditOptimisticImages({
          image: submittedEditImage,
          extraImages: conversationEditImages,
          excludeSourceImage: hasSelectionReference,
        });
        const editMaterializedFiles =
          editFileInputs.length > 0
            ? await materializeWorkspaceAttachmentsToFiles({
                client,
                agentId: editTargetAgentId,
                files: editFileInputs,
              })
            : [];
        const editFileAttachments =
          workspaceMaterializedFilesToPromptAttachments(editMaterializedFiles);
        const editAttachments = existingEditSourceAttachment
          ? [existingEditSourceAttachment, ...editFileAttachments]
          : editFileAttachments;
        const materializedSourceUrl = editMaterializedFiles.find((file) =>
          file.title.startsWith("ai-edit-source."),
        )?.url;
        const displaySelectionPreviewUri = materializedSourceUrl ?? selectionPreviewUri;
        const optimisticImages =
          editMaterializedFiles.length > 0
            ? workspaceMaterializedFilesToUserMessageImages(editMaterializedFiles).filter(
                (image) =>
                  !hasSelectionReference || image.fileName !== selectionImageForDisplay?.fileName,
              )
            : buildWorkspaceBackedUserImages({
                images: localOptimisticImages,
                attachments: editFileAttachments,
                cwd: sourceEditAgentCwd,
              });
        await saveAiCreationMessageDisplayMetadata({
          serverId,
          agentId: editTargetAgentId,
          messageId: clientMessageId,
          text: userMessageText,
          metadata: {
            images: optimisticImages,
            displayAttachments: editAttachments,
            ...(hasSelectionReference
              ? {
                  selectionPreviewUri: displaySelectionPreviewUri,
                  ...(selectionImageSource ? { selectionImageSource } : {}),
                  selectionImage: selectionImageForDisplay,
                }
              : {}),
          },
        }).catch((error) => {
          console.warn("[AiCreation] Failed to persist message display metadata", error);
        });
        appendOptimisticUserMessageToAgentStream(
          serverId,
          editTargetAgentId,
          buildOptimisticUserMessage({
            id: clientMessageId,
            text: userMessageText,
            timestamp: new Date(),
            images: optimisticImages,
            attachments: editAttachments,
            selectionPreviewUri: hasSelectionReference ? displaySelectionPreviewUri : undefined,
            ...(hasSelectionReference && selectionImageSource ? { selectionImageSource } : {}),
            ...(hasSelectionReference ? { selectionImage: selectionImageForDisplay } : {}),
          }),
          { placement: "active-head" },
        );
        await client.sendAgentMessage(editTargetAgentId, initialPrompt, {
          messageId: clientMessageId,
          ...(!hasSelectionGuide && editAttachments.length === 0 && images && images.length > 0
            ? { images }
            : {}),
          ...(editAttachments.length > 0 ? { attachments: editAttachments } : {}),
        });
        await composerState.persistFormPreferences();
        draft.clear("sent");
        clearAiCreationEditSource();
        setSelectionStrokes([]);
        setRedoSelectionStrokes([]);
        setConversationEditImages([]);
        setSelectionMode(false);
        router.push(buildHostAgentDetailRoute(serverId, editTargetAgentId));
        return;
      }

      if (!accountSession) {
        toast.error(t("aiCreation.error.loginRequired"));
        openAccountLogin(serverId);
        return;
      }

      const aiCreationAgentConfig: AiCreationAgentConfig = {
        provider: provider ?? "codex",
        ...(composerState.modeOptions.length > 0 && composerState.selectedMode
          ? { modeId: composerState.selectedMode }
          : {}),
        model: composerState.effectiveModelId || undefined,
        thinkingOptionId: composerState.effectiveThinkingOptionId || undefined,
        featureValues: composerState.featureValues,
      };
      const workspace = await createAiCreationWorkspace({
        accountSession,
        agentConfig: aiCreationAgentConfig,
        client,
        displayName: title,
        initialPrompt,
        mergeWorkspaces,
        hosts,
        serverId,
        setHasHydratedWorkspaces,
      });
      const runtimeClient = workspace.client;
      const runtimeServerId = workspace.nodeId ?? serverId;
      let fileAttachments:
        | Awaited<ReturnType<typeof materializeWorkspaceFileAttachments>>
        | undefined;
      let composerImages: typeof images = undefined;
      let displayAttachments: AgentAttachment[] = [];
      let editMaterializedFilesForDisplay: Awaited<
        ReturnType<typeof materializeWorkspaceAttachmentsToFiles>
      > = [];
      if (usesWorkspaceFileReferences(mode)) {
        const wirePayload = await splitComposerAttachmentsForSubmit(submittedReferenceAttachments, {
          materializeImages: (images) =>
            materializeWorkspaceImageAttachmentsForSubmit({
              client: runtimeClient,
              cwd: workspace.cwd,
              images,
            }),
          materializeFiles: (files) =>
            materializeWorkspaceFileAttachments({
              client: runtimeClient,
              cwd: workspace.cwd,
              files,
            }),
        });
        composerImages = await encodeImages(wirePayload.images);
        fileAttachments = wirePayload.attachments;
        displayAttachments = wirePayload.displayAttachments;
        if (wirePayload.displayImages.length > 0) {
          submittedReferences = wirePayload.displayImages;
        }
      } else if (mode === "image" && references.length > 0) {
        const materializedReferences = await materializeWorkspaceImageAttachmentsForSubmit({
          client: runtimeClient,
          cwd: workspace.cwd,
          images: references.map((reference, index) =>
            withAttachmentFileName(reference, `ai-reference-${index + 1}`),
          ),
        });
        fileAttachments = materializedReferences.attachments;
        submittedReferences = materializedReferences.images;
        composerImages = undefined;
      } else if (editFileInputs.length > 0) {
        editMaterializedFilesForDisplay = await materializeWorkspaceAttachmentsToFiles({
          client: runtimeClient,
          cwd: workspace.cwd,
          files: editFileInputs,
        });
        fileAttachments = workspaceMaterializedFilesToPromptAttachments(
          editMaterializedFilesForDisplay,
        );
      }
      if (existingEditSourceAttachment) {
        fileAttachments = [existingEditSourceAttachment, ...(fileAttachments ?? [])];
      }
      const config = buildWorkspaceDraftAgentConfig({
        ...aiCreationAgentConfig,
        cwd: workspace.cwd,
        title,
      });
      const initialImages =
        mode === "image" && references.length > 0 ? undefined : (images ?? composerImages);
      const result = await runtimeClient.createAgent({
        config,
        workspaceId: workspace.workspaceId,
        initialPrompt,
        clientMessageId,
        recordConversation,
        labels: {
          surface: "ai_creation",
          intent: getAiCreationIntentForMode(mode),
          ...buildAiCreationControlLabels(workspace),
        },
        ...(!hasSelectionGuide && initialImages && initialImages.length > 0
          ? { images: initialImages }
          : {}),
        ...(fileAttachments && fileAttachments.length > 0 ? { attachments: fileAttachments } : {}),
      });
      await appendAiCreationControlAgentBinding({
        accountSession,
        agentId: result.id,
        workspace,
      });
      setAgents(runtimeServerId, (previous) => {
        const next = new Map(previous);
        next.set(result.id, normalizeAgentSnapshot(result, runtimeServerId));
        return next;
      });
      const selectionImageForDisplay =
        mode === "edit" && hasSelectionGuide && submittedEditImage ? submittedEditImage : undefined;
      const hasSelectionReference = Boolean(selectionPreviewUri && selectionImageForDisplay);
      const materializedSourceUrl = editMaterializedFilesForDisplay.find((file) =>
        file.title.startsWith("ai-edit-source."),
      )?.url;
      const displaySelectionPreviewUri = materializedSourceUrl ?? selectionPreviewUri;
      const optimisticImages =
        mode === "edit"
          ? editMaterializedFilesForDisplay.length > 0
            ? workspaceMaterializedFilesToUserMessageImages(editMaterializedFilesForDisplay).filter(
                (image) =>
                  !hasSelectionReference || image.fileName !== selectionImageForDisplay?.fileName,
              )
            : buildEditOptimisticImages({
                image: submittedEditImage,
                extraImages: [],
                excludeSourceImage: hasSelectionReference,
              })
          : mode === "image"
            ? submittedReferences
            : [];
      const userMessageText = initialPrompt;
      await saveAiCreationMessageDisplayMetadata({
        serverId: runtimeServerId,
        agentId: result.id,
        messageId: clientMessageId,
        text: userMessageText,
        metadata: {
          images: optimisticImages,
          displayAttachments,
          ...(hasSelectionReference
            ? {
                selectionPreviewUri: displaySelectionPreviewUri,
                ...(selectionImageSource ? { selectionImageSource } : {}),
                selectionImage: selectionImageForDisplay,
              }
            : {}),
        },
      }).catch((error) => {
        console.warn("[AiCreation] Failed to persist message display metadata", error);
      });
      appendOptimisticUserMessageToAgentStream(
        runtimeServerId,
        result.id,
        buildOptimisticUserMessage({
          id: clientMessageId,
          text: userMessageText,
          timestamp: new Date(),
          images: optimisticImages,
          displayAttachments,
          selectionPreviewUri: hasSelectionReference ? displaySelectionPreviewUri : undefined,
          ...(hasSelectionReference && selectionImageSource ? { selectionImageSource } : {}),
          ...(hasSelectionReference ? { selectionImage: selectionImageForDisplay } : {}),
        }),
        { placement: "tail" },
      );
      await composerState.persistFormPreferences();
      draft.clear("sent");
      clearAiCreationEditSource();
      setReferenceAttachments([]);
      setConversationEditImages([]);
      setSelectionStrokes([]);
      setRedoSelectionStrokes([]);
      setSelectionMode(false);
      router.push(buildHostAgentDetailRoute(runtimeServerId, result.id));
    } catch (error) {
      const billingReason = getBillingUpgradeReason(error);
      if (billingReason) {
        openBillingUpgrade(billingReason);
      }
      toast.error(error instanceof Error ? error.message : t("aiCreation.error.start"));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    client,
    composerState,
    accountSession,
    appendOptimisticUserMessageToAgentStream,
    draft,
    editImage,
    editTargetAgentId,
    sourceEditAgentCwd,
    conversationEditImages,
    hosts,
    mergeWorkspaces,
    openAccountLogin,
    openBillingUpgrade,
    prompt,
    ratio,
    recordConversation,
    referenceAttachments,
    references,
    router,
    serverId,
    setAgents,
    setHasHydratedWorkspaces,
    style,
    t,
    toast,
    mode,
    selectionStrokes,
    selectionImageSource,
    selectionPreviewUri,
  ]);

  const modelSelector = composerState ? (
    <CombinedModelSelector
      providers={composerState.modelSelectorProviders}
      selectedProvider={selectedProvider}
      selectedModel={selectedModel}
      onSelect={handleSelectModel}
      isLoading={composerState.isAllModelsLoading}
      onOpen={composerState.refetchProviderModelsIfStale}
      onRetryProvider={composerState.refreshProviderModels}
      isRetryingProvider={composerState.isProviderModelsRefreshing}
      serverId={serverId}
      renderTrigger={({ selectedModelLabel }) => (
        <View style={styles.modelTrigger}>
          <Sparkles size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
          <Text style={styles.modelTriggerText} numberOfLines={1}>
            {selectedModelLabel}
          </Text>
        </View>
      )}
    />
  ) : null;
  const conversationReplayDraftControls = supportsConversationReplay ? (
    <ConversationReplayDraftControls
      recordConversation={recordConversation}
      onChangeRecordConversation={setRecordConversation}
    />
  ) : null;

  if (editTargetAgentId) {
    return (
      <View style={styles.conversationEditRoot}>
        <View style={styles.conversationEditTopBar}>
          <View style={styles.conversationEditTopLeft}>
            <Pressable
              style={styles.conversationEditIconButton}
              onPress={handleCloseConversationEdit}
              accessibilityRole="button"
              accessibilityLabel={t("aiCreation.action.closeEditor")}
            >
              <X size={theme.iconSize.md} color={theme.colors.foreground} />
            </Pressable>
            <Text style={styles.conversationEditTitle} numberOfLines={1}>
              {conversationEditTitle}
            </Text>
          </View>
          <View style={styles.conversationEditTopActions}>
            <Button
              variant={selectionMode ? "secondary" : "ghost"}
              size="sm"
              leftIcon={WandSparkles}
              onPress={handleToggleSelectionMode}
              disabled={!editImage}
            >
              {t("aiCreation.action.select")}
            </Button>
            <RatioDropdown
              label={t("aiCreation.aspectRatio")}
              value={ratio}
              options={RATIO_OPTIONS}
              getLabel={(value) => t(RATIO_LABEL_KEYS[value])}
              onChange={setRatio}
            />
            <View style={styles.conversationEditDivider} />
            <Button
              variant="default"
              size="sm"
              leftIcon={Copy}
              onPress={handleCopyEditImage}
              disabled={!editImage || isCopyingImage}
            >
              {isCopyingImage
                ? t("aiCreation.action.copyingImage")
                : t("aiCreation.action.copyImage")}
            </Button>
            <Pressable
              style={styles.conversationEditIconButton}
              accessibilityRole="button"
              accessibilityLabel={t("aiCreation.action.downloadImage")}
              onPress={handleDownloadEditImage}
              disabled={!editImage || isDownloadingImage}
            >
              <Download size={theme.iconSize.md} color={theme.colors.foreground} />
            </Pressable>
          </View>
        </View>
        {selectionMode ? (
          <SelectionBrushToolbar
            brushSize={selectionBrushSize}
            color={selectionColor}
            canUndo={selectionStrokes.length > 0}
            canRedo={redoSelectionStrokes.length > 0}
            canClear={selectionStrokes.length > 0}
            onChangeBrushSize={setSelectionBrushSize}
            onChangeColor={setSelectionColor}
            onUndo={handleUndoSelection}
            onRedo={handleRedoSelection}
            onClear={handleClearSelection}
          />
        ) : null}
        <View style={styles.conversationEditContent}>
          <View style={styles.conversationEditStage}>
            <EditCanvas
              image={editImage}
              selectionMode={selectionMode}
              strokes={selectionStrokes}
              brushSize={selectionBrushSize}
              color={selectionColor}
              onChangeStrokes={handleChangeSelectionStrokes}
              onPickImage={handlePickEditImage}
              variant="conversation"
            />
          </View>
          <View style={styles.conversationEditComposer}>
            <TextInput
              nativeID="ai-creation-prompt"
              value={prompt}
              onChangeText={setPrompt}
              placeholder={t("aiCreation.prompt.editPlaceholder")}
              placeholderTextColor={theme.colors.foregroundMuted}
              multiline
              style={styles.conversationEditPromptInput}
              textAlignVertical="top"
            />
            {conversationEditImages.length > 0 ? (
              <View style={styles.referenceRow}>
                {conversationEditImages.map((image) => (
                  <ReferenceThumb
                    key={image.id}
                    image={image}
                    onRemove={handleRemoveConversationEditImage}
                  />
                ))}
              </View>
            ) : null}
            <View style={styles.conversationEditComposerToolbar}>
              <Pressable
                style={styles.conversationEditAddButton}
                onPress={handlePickConversationEditImage}
                accessibilityRole="button"
                accessibilityLabel={t("aiCreation.action.uploadImage")}
              >
                <Text style={styles.conversationEditAddText}>+</Text>
              </Pressable>
              <View style={styles.toolbarSpacer} />
              {modelSelector}
              {conversationReplayDraftControls}
              <Pressable
                style={styles.micButton}
                accessibilityRole="button"
                accessibilityLabel={t("aiCreation.action.voicePrompt")}
              >
                <Mic size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
              </Pressable>
              <Button
                variant="default"
                size="sm"
                disabled={!canSubmit || isSubmitting}
                loading={isSubmitting}
                onPress={handleCreate}
                leftIcon={ArrowUp}
                style={styles.conversationEditSubmitButton}
                testID="ai-creation-submit"
              />
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {isCompact ? (
        <MenuHeader title={t("aiCreation.title")} />
      ) : (
        <AiCreationTopBar onNewSession={handleNewSession} onToggleSidebar={handleToggleSidebar} />
      )}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        onScroll={handleInspirationScroll}
        scrollEventThrottle={250}
      >
        <View style={styles.creationShell}>
          <View style={styles.creationHeader}>
            <Text style={styles.title}>{t("aiCreation.title")}</Text>
            <View style={styles.subtitleTypewriterFrame}>
              <Text style={styles.subtitleMeasure}>{subtitleText}</Text>
              <View style={styles.subtitleTypewriterLine}>
                <Text style={styles.subtitle}>{typedSubtitle}</Text>
                {isSubtitleTyping ? <Text style={styles.subtitleCaret}>|</Text> : null}
              </View>
            </View>
          </View>

          <View style={styles.creationBody}>
            <View style={styles.creationMain}>
              {mode === "edit" ? (
                <EditCanvas
                  image={editImage}
                  selectionMode={selectionMode}
                  strokes={selectionStrokes}
                  brushSize={selectionBrushSize}
                  color={selectionColor}
                  onChangeStrokes={handleChangeSelectionStrokes}
                  onPickImage={handlePickEditImage}
                />
              ) : null}

              <View
                style={[styles.composer, isComposerFocused && styles.composerFocused]}
                testID="ai-creation-composer"
              >
                <TextInput
                  autoFocus={!isCompact}
                  nativeID="ai-creation-prompt"
                  value={prompt}
                  onChangeText={handleChangePrompt}
                  onBlur={() => setIsComposerFocused(false)}
                  onFocus={() => setIsComposerFocused(true)}
                  placeholder={
                    mode === "edit"
                      ? t("aiCreation.prompt.editPlaceholder")
                      : t(getPromptPlaceholderKey(mode))
                  }
                  placeholderTextColor={theme.colors.foregroundMuted}
                  multiline
                  style={promptInputStyle}
                  scrollEnabled={isPromptInputScrollable}
                  onContentSizeChange={handlePromptContentSizeChange}
                  textAlignVertical="top"
                />
                {references.length > 0 ? (
                  <View style={styles.referenceRow}>
                    {references.map((image) => (
                      <ReferenceThumb
                        key={image.id}
                        image={image}
                        onRemove={handleRemoveReference}
                      />
                    ))}
                  </View>
                ) : null}
                <View style={styles.toolbar}>
                  <View style={styles.toolbarLeft}>
                    <View style={styles.modePillRow} testID="ai-creation-mode">
                      {modeOptions.map((option) => (
                        <CreationModePill
                          key={option.value}
                          mode={option.value}
                          label={option.label}
                          selected={mode === option.value}
                          onPress={handleChangeMode}
                        />
                      ))}
                    </View>
                    <Button
                      variant="ghost"
                      size="sm"
                      onPress={mode === "edit" ? handlePickEditImage : handlePickReference}
                      leftIcon={mode === "edit" ? ImagePlus : Paperclip}
                    >
                      {mode === "edit"
                        ? t("aiCreation.source.original")
                        : usesWorkspaceFileReferences(mode)
                          ? t("aiCreation.source.material")
                          : t("aiCreation.source.reference")}
                    </Button>
                    {mode === "edit" ? (
                      <Button
                        variant={selectionMode ? "secondary" : "ghost"}
                        size="sm"
                        leftIcon={WandSparkles}
                        onPress={handleToggleSelectionMode}
                        disabled={!editImage}
                      >
                        {t("aiCreation.action.select")}
                      </Button>
                    ) : null}
                    {mode === "edit" && selectionStrokes.length > 0 ? (
                      <Button variant="ghost" size="sm" onPress={handleClearSelection}>
                        {t("aiCreation.action.clear")}
                      </Button>
                    ) : null}
                    {usesAspectRatio(mode) ? (
                      <RatioDropdown
                        label={t("aiCreation.aspectRatio")}
                        value={ratio}
                        options={mode === "slides" ? SLIDE_RATIO_OPTIONS : RATIO_OPTIONS}
                        getLabel={(value) => t(RATIO_LABEL_KEYS[value])}
                        onChange={setRatio}
                      />
                    ) : null}
                    {mode === "image" ? (
                      <StyleDropdown
                        label={t("aiCreation.style")}
                        value={style}
                        options={STYLE_OPTIONS}
                        getLabel={(option) => t(option.key)}
                        onChange={(nextStyle) => setStyle(nextStyle)}
                      />
                    ) : null}
                  </View>
                  <View style={styles.toolbarRight}>
                    {modelSelector}
                    {conversationReplayDraftControls}
                    <Pressable
                      style={styles.micButton}
                      accessibilityRole="button"
                      accessibilityLabel={t("aiCreation.action.voicePrompt")}
                    >
                      <Mic size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
                    </Pressable>
                    <Button
                      variant="default"
                      size="sm"
                      disabled={!canSubmit || isSubmitting}
                      loading={isSubmitting}
                      onPress={handleCreate}
                      leftIcon={ArrowUp}
                      style={styles.composerSubmitButton}
                      testID="ai-creation-submit"
                    />
                  </View>
                </View>
              </View>
            </View>
          </View>
          <AiCreationFeatureRow onSelectMode={handleChangeMode} />
          <InspirationWaterfall
            visibleCount={visibleInspirationCount}
            onUsePrompt={handleUseInspirationPrompt}
          />
          <View style={styles.inspirationFooter}>
            <View style={styles.inspirationFooterLine} />
            <Text style={styles.inspirationFooterText}>~</Text>
            <View style={styles.inspirationFooterLine} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function AiCreationTopBar({
  onNewSession,
  onToggleSidebar,
}: {
  onNewSession: () => void;
  onToggleSidebar: () => void;
}) {
  const { theme } = useUnistyles();
  const padding = useWindowControlsPadding("header");
  const topBarStyle = useMemo(
    () => [
      styles.topBar,
      {
        paddingLeft: HEADER_HORIZONTAL_PADDING + padding.left,
        paddingRight: HEADER_HORIZONTAL_PADDING + padding.right,
      },
    ],
    [padding.left, padding.right],
  );
  return (
    <View style={topBarStyle}>
      <TitlebarDragRegion />
      <View style={styles.topBarIconGroup}>
        <Pressable
          style={styles.topBarIconBox}
          accessibilityRole="button"
          accessibilityLabel={translateNow("ui.toggle.left.sidebar.1gb2s1b")}
          onPress={onToggleSidebar}
        >
          <PanelLeft size={theme.iconSize.md} color={theme.colors.foreground} />
        </Pressable>
        <Pressable
          style={styles.topBarIconBox}
          accessibilityRole="button"
          accessibilityLabel={translateNow("openProject.newProject.title")}
          onPress={onNewSession}
        >
          <SquarePen size={theme.iconSize.md} color={theme.colors.foreground} />
        </Pressable>
      </View>
    </View>
  );
}

function AiCreationFeatureRow({ onSelectMode }: { onSelectMode: (mode: CreationMode) => void }) {
  return (
    <View style={styles.featureRow}>
      {AI_CREATION_FEATURES.map((feature) => (
        <AiCreationFeatureCard key={feature.key} feature={feature} onSelectMode={onSelectMode} />
      ))}
    </View>
  );
}

function AiCreationFeatureCard({
  feature,
  onSelectMode,
}: {
  feature: AiCreationFeatureItem;
  onSelectMode: (mode: CreationMode) => void;
}) {
  const { t } = useI18n();
  const interaction = useRef(new Animated.Value(0)).current;
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const label = t(feature.key);
  const target = isPressed ? 2 : isHovered ? 1 : 0;

  useEffect(() => {
    Animated.timing(interaction, {
      toValue: target,
      duration: isPressed ? 90 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [interaction, isPressed, target]);

  const cardAnimatedStyle = useMemo(
    () => ({
      borderColor: interaction.interpolate({
        inputRange: [0, 1, 2],
        outputRange: ["#00000014", feature.accentColor, feature.accentColor],
      }),
      backgroundColor: interaction.interpolate({
        inputRange: [0, 1, 2],
        outputRange: [
          feature.backgroundColor,
          feature.hoverBackgroundColor,
          feature.pressBackgroundColor,
        ],
      }),
      transform: [
        {
          translateY: interaction.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [0, -3, 1],
          }),
        },
      ],
    }),
    [feature, interaction],
  );
  const imageAnimatedStyle = useMemo(
    () => ({
      transform: [
        {
          translateY: interaction.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [0, -4, 1],
          }),
        },
      ],
    }),
    [interaction],
  );
  const handlePress = useCallback(() => onSelectMode(feature.mode), [feature.mode, onSelectMode]);
  const handleHoverIn = useCallback(() => setIsHovered(true), []);
  const handleHoverOut = useCallback(() => setIsHovered(false), []);
  const handlePressIn = useCallback(() => setIsPressed(true), []);
  const handlePressOut = useCallback(() => setIsPressed(false), []);

  return (
    <Pressable
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.featureCardOuter, { width: feature.width }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.featureCard, cardAnimatedStyle]}>
        <Text numberOfLines={1} style={styles.featureCardText}>
          {label}
        </Text>
        <Animated.Image
          source={feature.source}
          style={[styles.featureCardImage, imageAnimatedStyle]}
          resizeMode="contain"
        />
      </Animated.View>
    </Pressable>
  );
}

function CreationModePill({
  label,
  mode,
  onPress,
  selected,
}: {
  label: string;
  mode: CreationSurfaceMode;
  onPress: (mode: CreationMode) => void;
  selected: boolean;
}) {
  const handlePress = useCallback(() => onPress(mode), [mode, onPress]);
  const modeIcon = MODE_ICON_BY_MODE[mode];
  const ModeIcon = modeIcon.icon;
  return (
    <Tooltip delayDuration={250} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={handlePress}
          style={(state) => modePillStyle({ ...state, selected })}
        >
          <ModeIcon size={16} color={modeIcon.color} strokeWidth={2} />
        </Pressable>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.modePillTooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

function InspirationWaterfall({
  onUsePrompt,
  visibleCount,
}: {
  onUsePrompt: (prompt: string) => void;
  visibleCount: number;
}) {
  const [layoutWidth, setLayoutWidth] = useState(0);
  const columnCount = getInspirationColumnCount(layoutWidth);
  const columns = useMemo(
    () => buildInspirationColumns(INSPIRATION_ITEMS.slice(0, visibleCount), columnCount),
    [columnCount, visibleCount],
  );
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setLayoutWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <View style={styles.inspirationGrid} onLayout={handleLayout}>
      {columns.map((column, columnIndex) => (
        <View key={`column-${columnIndex}`} style={styles.inspirationColumn}>
          {column.map((item) => (
            <InspirationTile key={item.order} item={item} onUsePrompt={onUsePrompt} />
          ))}
        </View>
      ))}
    </View>
  );
}

function getInspirationColumnCount(width: number): number {
  if (width <= 0) return 3;
  if (width >= 1200) return 5;
  if (width >= 900) return 4;
  if (width >= 620) return 3;
  if (width >= 360) return 2;
  return 1;
}

function buildInspirationColumns(
  items: InspirationItem[],
  columnCount: number,
): InspirationItem[][] {
  const columns = Array.from({ length: columnCount }, () => [] as InspirationItem[]);
  const columnHeights = Array.from({ length: columnCount }, () => 0);
  for (const item of items) {
    let shortestColumnIndex = 0;
    for (let index = 1; index < columnHeights.length; index += 1) {
      if (columnHeights[index] < columnHeights[shortestColumnIndex]) {
        shortestColumnIndex = index;
      }
    }
    columns[shortestColumnIndex]?.push(item);
    columnHeights[shortestColumnIndex] += item.height + 2;
  }
  return columns;
}

function InspirationTile({
  item,
  onUsePrompt,
}: {
  item: InspirationItem;
  onUsePrompt: (prompt: string) => void;
}) {
  const { t } = useI18n();
  const [isHovered, setIsHovered] = useState(false);
  const prompt = getInspirationPrompt(item.order);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handlePress = useCallback(() => {
    if (prompt) {
      onUsePrompt(prompt);
    }
  }, [onUsePrompt, prompt]);

  return (
    <View
      style={[styles.inspirationTile, { aspectRatio: INSPIRATION_TILE_DESIGN_WIDTH / item.height }]}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Image
        accessible={false}
        resizeMode="cover"
        source={item.source}
        style={styles.inspirationImage}
      />
      <View
        pointerEvents={isHovered ? "auto" : "none"}
        style={[
          styles.inspirationOverlay,
          isHovered ? styles.inspirationOverlayVisible : styles.inspirationOverlayHidden,
        ]}
      >
        <Text numberOfLines={3} style={styles.inspirationPromptText}>
          {prompt}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("aiCreation.inspiration.useSame")}
          onPress={handlePress}
          style={({ hovered, pressed }) => [
            styles.inspirationUseButton,
            (hovered || pressed) && styles.inspirationUseButtonActive,
          ]}
        >
          <ImagePlus size={20} color="#ffffff" />
          <Text style={styles.inspirationUseButtonText}>{t("aiCreation.inspiration.useSame")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function EditCanvas({
  image,
  selectionMode,
  strokes,
  brushSize,
  color,
  onChangeStrokes,
  onPickImage,
  variant = "default",
}: {
  image: AttachmentMetadata | null;
  selectionMode: boolean;
  strokes: SelectionStroke[];
  brushSize: number;
  color: string;
  onChangeStrokes: (strokes: SelectionStroke[]) => void;
  onPickImage: () => void;
  variant?: "default" | "conversation";
}) {
  const { t } = useI18n();
  const uri = useAttachmentPreviewUrl(image);
  const overlayRef = useRef<View>(null);
  const [containerLayout, setContainerLayout] = useState<CanvasLayout>({ width: 0, height: 0 });
  const [canvasLayout, setCanvasLayout] = useState<CanvasLayout>({ width: 0, height: 0 });
  const canvasBoundsRef = useRef<CanvasBounds | null>(null);
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
  const [draftStroke, setDraftStroke] = useState<SelectionStroke>({
    points: [],
    width: brushSize,
    color,
  });
  const allStrokes =
    draftStroke.points.length > 0 ? [...strokes, { ...draftStroke, width: brushSize }] : strokes;
  const imageSource = useMemo(() => (uri ? { uri } : null), [uri]);
  const imageBoxSize = useMemo(() => {
    if (!imageAspectRatio) return null;
    if (variant === "conversation") {
      return fitAspectRatioWithinBox({
        aspectRatio: imageAspectRatio,
        boxWidth: containerLayout.width,
        boxHeight: containerLayout.height,
      });
    }
    const maxWidth = Math.min(
      Math.max(0, containerLayout.width - EDIT_CANVAS_STAGE_HORIZONTAL_PADDING),
      EDIT_CANVAS_MAX_IMAGE_WIDTH,
    );
    if (maxWidth <= 0) return null;
    return { width: maxWidth, height: maxWidth / imageAspectRatio };
  }, [containerLayout.height, containerLayout.width, imageAspectRatio, variant]);
  const imageFrameStyle = useMemo(
    () => [
      variant === "conversation" ? styles.conversationEditImageFrame : styles.editImageFrame,
      imageBoxSize ?? styles.editImageFrameFallback,
    ],
    [imageBoxSize, variant],
  );
  const selectionViewBox = useMemo(() => {
    const width = Math.max(1, Math.round(canvasLayout.width));
    const height = Math.max(1, Math.round(canvasLayout.height));
    return `0 0 ${width} ${height}`;
  }, [canvasLayout.height, canvasLayout.width]);

  useEffect(() => {
    if (!uri) {
      setImageAspectRatio(null);
      return;
    }
    let cancelled = false;
    Image.getSize(uri, (width, height) => {
      if (!cancelled && width > 0 && height > 0) {
        setImageAspectRatio(width / height);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const measureCanvasBounds = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) {
        canvasBoundsRef.current = { x, y, width, height };
      }
    });
  }, []);
  const handleCanvasLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const { width, height } = event.nativeEvent.layout;
      setCanvasLayout({ width, height });
      requestAnimationFrame(measureCanvasBounds);
    },
    [measureCanvasBounds],
  );
  useEffect(() => {
    measureCanvasBounds();
  }, [canvasLayout.height, canvasLayout.width, measureCanvasBounds]);
  useEffect(() => {
    if (selectionMode) {
      measureCanvasBounds();
    }
  }, [measureCanvasBounds, selectionMode]);
  const pointFromPageCoordinates = useCallback(
    (pageX: number, pageY: number): SelectionPoint | null => {
      const bounds = canvasBoundsRef.current;
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        return null;
      }
      return {
        x: clamp((pageX - bounds.x) / bounds.width, 0, 1),
        y: clamp((pageY - bounds.y) / bounds.height, 0, 1),
      };
    },
    [],
  );
  const pointFromLocalCoordinates = useCallback(
    (locationX: number, locationY: number): SelectionPoint | null => {
      if (canvasLayout.width <= 0 || canvasLayout.height <= 0) {
        return null;
      }
      return {
        x: clamp(locationX / canvasLayout.width, 0, 1),
        y: clamp(locationY / canvasLayout.height, 0, 1),
      };
    },
    [canvasLayout.height, canvasLayout.width],
  );
  const pointFromEvent = useCallback(
    (event: GestureResponderEvent): SelectionPoint | null => {
      const { locationX, locationY, pageX, pageY } = event.nativeEvent;
      return (
        pointFromPageCoordinates(pageX, pageY) ?? pointFromLocalCoordinates(locationX, locationY)
      );
    },
    [pointFromLocalCoordinates, pointFromPageCoordinates],
  );
  const handleContainerLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContainerLayout({ width, height });
  }, []);
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => selectionMode,
        onMoveShouldSetPanResponder: () => selectionMode,
        onPanResponderGrant: (event) => {
          const point = pointFromEvent(event);
          setDraftStroke({ points: point ? [point] : [], width: brushSize, color });
        },
        onPanResponderMove: (event) => {
          const point = pointFromEvent(event);
          if (!point) return;
          setDraftStroke((current) => ({
            points: [...current.points, point],
            width: brushSize,
            color: current.color || color,
          }));
        },
        onPanResponderRelease: () => {
          setDraftStroke((current) => {
            if (current.points.length > 1) {
              onChangeStrokes([...strokes, current]);
            }
            return { points: [], width: brushSize, color };
          });
        },
        onPanResponderTerminate: () => {
          setDraftStroke({ points: [], width: brushSize, color });
        },
      }),
    [brushSize, color, onChangeStrokes, pointFromEvent, selectionMode, strokes],
  );
  return (
    <View
      style={variant === "conversation" ? styles.conversationEditCanvas : styles.editStage}
      onLayout={handleContainerLayout}
    >
      {imageSource ? (
        <View style={imageFrameStyle} onLayout={handleCanvasLayout}>
          <Image source={imageSource} style={styles.editImage} resizeMode="stretch" />
          <View
            ref={overlayRef}
            style={styles.selectionOverlay}
            pointerEvents={selectionMode ? "auto" : "none"}
            {...panResponder.panHandlers}
          >
            {allStrokes.length > 0 ? (
              <Svg
                style={styles.selectionCanvas}
                viewBox={selectionViewBox}
                preserveAspectRatio="none"
              >
                {allStrokes.map((stroke) => (
                  <Path
                    key={selectionStrokeKey(stroke)}
                    d={selectionStrokePath(stroke, canvasLayout)}
                    fill="none"
                    stroke={stroke.color || SELECTION_DEFAULT_STROKE_COLOR}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={selectionStrokeWidth(stroke, canvasLayout)}
                  />
                ))}
              </Svg>
            ) : null}
          </View>
        </View>
      ) : (
        <Pressable style={styles.editUploadTarget} onPress={onPickImage} accessibilityRole="button">
          <ImagePlus size={28} color={styles.editUploadIcon.color} />
          <Text style={styles.editUploadText}>{t("aiCreation.uploadToEdit")}</Text>
        </Pressable>
      )}
    </View>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fitAspectRatioWithinBox({
  aspectRatio,
  boxWidth,
  boxHeight,
}: {
  aspectRatio: number;
  boxWidth: number;
  boxHeight: number;
}): CanvasLayout | null {
  if (aspectRatio <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return null;
  }
  const boxAspectRatio = boxWidth / boxHeight;
  if (boxAspectRatio > aspectRatio) {
    const height = boxHeight;
    return { width: height * aspectRatio, height };
  }
  const width = boxWidth;
  return { width, height: width / aspectRatio };
}

function selectionCoordinate(value: number, size: number): number {
  return Math.round(clamp(value, 0, 1) * Math.max(1, size));
}

function selectionStrokePath(stroke: SelectionStroke, layout: CanvasLayout): string {
  const [first, ...rest] = stroke.points;
  if (!first) {
    return "";
  }
  const width = Math.max(1, layout.width);
  const height = Math.max(1, layout.height);
  const head = `M ${selectionCoordinate(first.x, width)} ${selectionCoordinate(first.y, height)}`;
  const tail = rest
    .map(
      (point) => `L ${selectionCoordinate(point.x, width)} ${selectionCoordinate(point.y, height)}`,
    )
    .join(" ");
  return tail ? `${head} ${tail}` : head;
}

function selectionStrokeWidth(stroke: SelectionStroke, layout: CanvasLayout): number {
  const scale = Math.min(Math.max(1, layout.width), Math.max(1, layout.height)) / MASK_VIEWBOX_SIZE;
  return Math.max(1, stroke.width * scale);
}

function selectionStrokeKey(stroke: SelectionStroke): string {
  const first = stroke.points[0];
  const last = stroke.points[stroke.points.length - 1];
  return `${stroke.points.length}:${stroke.width}:${first?.x ?? 0}:${first?.y ?? 0}:${last?.x ?? 0}:${last?.y ?? 0}`;
}

async function resolveSelectionGuideDimensions(input: {
  mode: CreationMode;
  selectionStrokes: SelectionStroke[];
  selectionPreviewUri?: string;
}): Promise<ImageDimensions | null> {
  if (input.mode !== "edit" || input.selectionStrokes.length === 0) {
    return null;
  }
  if (!input.selectionPreviewUri) {
    throw new Error(
      "Unable to create selection guide because the source image preview is missing.",
    );
  }
  return await getImageDimensions(input.selectionPreviewUri);
}

async function createSelectionGuideAttachment(
  strokes: SelectionStroke[],
  dimensions: ImageDimensions | null,
  sourcePreviewUri?: string,
  sourceImage?: AttachmentMetadata | null,
  client?: DaemonClient | null,
): Promise<WorkspaceMaterializeAttachment | null> {
  if (strokes.length === 0) {
    return null;
  }
  if (!sourcePreviewUri) {
    throw new Error(
      "Unable to create selection guide because the source image preview is missing.",
    );
  }
  if (!dimensions) {
    throw new Error("Unable to create selection guide because the source image size is unknown.");
  }
  const sourceDataUrl = await resolveSelectionGuideSourceDataUrl({
    sourceImage,
    fallbackPreviewUri: sourcePreviewUri,
    client,
  });
  const guide = await createSelectionGuideDataUrl(strokes, dimensions, sourceDataUrl);
  const attachment = await persistAttachmentFromDataUrl({
    dataUrl: guide.dataUrl,
    mimeType: guide.mimeType,
    fileName: guide.fileName,
  });
  return {
    ...attachment,
    fallbackPreviewUrl: guide.dataUrl,
  };
}

async function resolveSelectionGuideSourceDataUrl(input: {
  sourceImage: AttachmentMetadata | null | undefined;
  fallbackPreviewUri: string;
  client?: DaemonClient | null;
}): Promise<string> {
  const sourceStorageType = input.sourceImage?.storageType;
  if (input.sourceImage && input.client && sourceStorageType === "desktop-file") {
    const sourcePath = input.sourceImage.storageKey.trim();
    if (sourcePath) {
      try {
        const file = await input.client.readFile("/", sourcePath);
        if (file.kind === "image") {
          return `data:${file.mime};base64,${bytesToBase64(file.bytes)}`;
        }
      } catch (error) {
        console.warn("[AiCreation] Failed to read workspace source image for selection guide", {
          sourcePath,
          error,
        });
      }
    }
  }

  const previewDataUrl = await resolvePreviewUriDataUrl(input.fallbackPreviewUri);
  if (previewDataUrl) {
    return previewDataUrl;
  }

  if (input.sourceImage && sourceStorageType !== "desktop-file") {
    const encoded = await encodeAttachmentsForSend([input.sourceImage]);
    const source = encoded?.[0];
    if (source?.data) {
      return `data:${source.mimeType};base64,${source.data}`;
    }
  }
  throw new Error("Unable to create selection guide because the source image data is unavailable.");
}

async function resolvePreviewUriDataUrl(uri: string): Promise<string | null> {
  if (/^data:/i.test(uri)) {
    return uri;
  }
  try {
    const response = await fetch(uri);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const mimeType = blob.type || "image/png";
    return `data:${mimeType};base64,${await blobToBase64(blob)}`;
  } catch (error) {
    console.warn("[AiCreation] Failed to fetch source image preview for selection guide", {
      uri,
      error,
    });
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function createSelectionGuideDataUrl(
  strokes: SelectionStroke[],
  dimensions: ImageDimensions,
  sourcePreviewUri: string,
): Promise<{
  dataUrl: string;
  mimeType: string;
  fileName: string;
}> {
  if (!isWeb || typeof document === "undefined") {
    throw new Error("Selection guide creation is only available in the browser editor.");
  }
  const width = Math.max(1, Math.round(dimensions.width));
  const height = Math.max(1, Math.round(dimensions.height));
  const strokeScale = Math.min(width, height) / MASK_VIEWBOX_SIZE;
  const image = await loadBrowserImage(sourcePreviewUri);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Unable to create selection guide image.");
  }
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  context.globalCompositeOperation = "source-over";
  context.lineCap = "round";
  context.lineJoin = "round";
  for (const stroke of strokes) {
    const [first, ...rest] = stroke.points;
    if (!first) {
      continue;
    }
    context.lineWidth = Math.max(1, stroke.width * strokeScale);
    context.strokeStyle = stroke.color || SELECTION_DEFAULT_STROKE_COLOR;
    context.beginPath();
    context.moveTo(first.x * width, first.y * height);
    for (const point of rest) {
      context.lineTo(point.x * width, point.y * height);
    }
    context.stroke();
  }
  return {
    dataUrl: canvas.toDataURL("image/png"),
    mimeType: "image/png",
    fileName: "selection-guide.png",
  };
}

async function loadBrowserImage(uri: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = document.createElement("img");
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load source image for selection guide."));
    image.src = uri;
  });
}

async function getImageDimensions(uri: string): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    Image.getSize(
      uri,
      (width, height) => {
        resolve({ width, height });
      },
      (error) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

async function persistPickedImagesWithFallbackPreviewUrl(
  pickedImages: readonly PickedImageAttachmentInput[],
): Promise<WorkspaceMaterializeAttachment[]> {
  return await Promise.all(
    pickedImages.map(async (picked) => {
      const fileName = picked.fileName ?? null;
      const mimeType = picked.mimeType || "image/jpeg";
      if (picked.source.kind === "blob") {
        const attachment = await persistAttachmentFromBlob({
          blob: picked.source.blob,
          mimeType,
          fileName,
        });
        const fallbackPreviewUrl =
          typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
            ? URL.createObjectURL(picked.source.blob)
            : null;
        return {
          ...attachment,
          fallbackPreviewUrl,
        };
      }
      const attachment = await persistAttachmentFromFileUri({
        uri: picked.source.uri,
        mimeType,
        fileName,
      });
      return {
        ...attachment,
        fallbackPreviewUrl: picked.source.uri,
      };
    }),
  );
}

async function encodeAiCreationImagesForSubmit(input: {
  mode: CreationMode;
  client?: DaemonClient | null;
  references: AttachmentMetadata[];
  conversationEditImages: AttachmentMetadata[];
  includeImagePayload: boolean;
  selectionStrokes: SelectionStroke[];
  selectionGuideDimensions: ImageDimensions | null;
  selectionPreviewUri?: string;
}): Promise<EncodedAiCreationImages> {
  if (usesWorkspaceFileReferences(input.mode)) {
    return { hasSelectionGuide: false, selectionGuide: null };
  }

  const selectionGuide =
    input.mode === "edit" && input.selectionStrokes.length > 0
      ? await createSelectionGuideAttachment(
          input.selectionStrokes,
          input.selectionGuideDimensions,
          input.selectionPreviewUri,
          input.references[0],
          input.client,
        )
      : null;
  const imageInputs =
    input.mode === "edit"
      ? buildImageEditInputs(input.references[0], selectionGuide, input.conversationEditImages)
      : input.references.map((reference, index) =>
          withAttachmentFileName(reference, `ai-reference-${index + 1}`),
        );
  const hasSelectionGuide = selectionGuide !== null;
  return {
    images:
      hasSelectionGuide || !input.includeImagePayload ? undefined : await encodeImages(imageInputs),
    hasSelectionGuide,
    selectionGuide,
  };
}

function buildImageEditInputs(
  sourceImage: AttachmentMetadata | undefined,
  selectionGuide: WorkspaceMaterializeAttachment | null,
  extraImages: AttachmentMetadata[],
): AttachmentMetadata[] {
  if (!sourceImage) {
    return [];
  }
  const inputs = [withAttachmentFileName(sourceImage, "ai-edit-source")];
  if (selectionGuide) {
    inputs.push(withAttachmentFileName(selectionGuide, "ai-edit-selection-guide"));
  }
  inputs.push(
    ...extraImages.map((image, index) =>
      withAttachmentFileName(image, `ai-edit-reference-${index + 1}`),
    ),
  );
  return inputs;
}

function buildGuidedImageEditMaterializeInputs(input: {
  sourceImage: AttachmentMetadata | null | undefined;
  sourceFallbackPreviewUrl?: string | null;
  includeSourceImage: boolean;
  selectionGuide: WorkspaceMaterializeAttachment;
  extraImages: AttachmentMetadata[];
}): WorkspaceMaterializeAttachment[] {
  const inputs: WorkspaceMaterializeAttachment[] = [];
  if (input.includeSourceImage && input.sourceImage) {
    inputs.push({
      ...withAttachmentFileName(input.sourceImage, "ai-edit-source"),
      fallbackPreviewUrl: input.sourceFallbackPreviewUrl,
    });
  }
  inputs.push({
    ...withAttachmentFileName(input.selectionGuide, "ai-edit-selection-guide"),
    fallbackPreviewUrl: input.selectionGuide.fallbackPreviewUrl,
  });
  inputs.push(
    ...input.extraImages.map((image, index) =>
      withAttachmentFileName(image, `ai-edit-reference-${index + 1}`),
    ),
  );
  return inputs;
}

function buildConversationImageEditMaterializeInputs(input: {
  sourceImage: AttachmentMetadata | null | undefined;
  sourceFallbackPreviewUrl?: string | null;
  includeSourceImage: boolean;
  selectionGuide: WorkspaceMaterializeAttachment | null;
  extraImages: AttachmentMetadata[];
}): WorkspaceMaterializeAttachment[] {
  const inputs: WorkspaceMaterializeAttachment[] = [];
  if (input.includeSourceImage && input.sourceImage) {
    inputs.push({
      ...withAttachmentFileName(input.sourceImage, "ai-edit-source"),
      fallbackPreviewUrl: input.sourceFallbackPreviewUrl,
    });
  }
  if (input.selectionGuide) {
    inputs.push({
      ...withAttachmentFileName(input.selectionGuide, "ai-edit-selection-guide"),
      fallbackPreviewUrl: input.selectionGuide.fallbackPreviewUrl,
    });
  }
  inputs.push(
    ...input.extraImages.map((image, index) =>
      withAttachmentFileName(image, `ai-edit-reference-${index + 1}`),
    ),
  );
  return inputs;
}

function withAttachmentFileName(
  attachment: AttachmentMetadata,
  baseName: string,
): AttachmentMetadata {
  return {
    ...attachment,
    fileName: `${baseName}.${getAttachmentExtension(attachment)}`,
  };
}

function getAttachmentExtension(attachment: AttachmentMetadata): string {
  const fromMimeType = IMAGE_EXTENSION_BY_MIME_TYPE[attachment.mimeType.toLowerCase()];
  if (fromMimeType) {
    return fromMimeType;
  }
  const fileName = attachment.fileName?.trim();
  const extension = fileName?.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  return extension || "png";
}

function resolveWorkspaceRelativeImagePath(source: string | undefined): string | null {
  const value = source?.trim();
  if (!value || value.includes("\0") || value.includes("\n") || value.includes("\r")) {
    return null;
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) || value.startsWith("/")) {
    return null;
  }
  const normalized = value.replace(/^\.\//u, "");
  return normalized.length > 0 ? normalized : null;
}

function buildWorkspacePathAttachment(input: {
  title: string;
  mimeType: string;
  path: string;
}): Extract<AgentAttachment, { type: "text" }> {
  return {
    type: "text",
    mimeType: "text/plain",
    title: input.title,
    text: [
      `Uploaded file: ${input.title}`,
      `MIME type: ${input.mimeType}`,
      `Workspace path: ${input.path}`,
      "Use the workspace path above when the user asks about this file.",
    ].join("\n"),
  };
}

function resolveDownloadFileName(attachment: AttachmentMetadata): string {
  const fallback = `doya-image.${getAttachmentExtension(attachment)}`;
  const fileName = attachment.fileName?.trim() || fallback;
  return fileName.replace(/[\\/:*?"<>|]+/g, "-");
}

function triggerImageDownload(input: { data: string; mimeType: string; fileName: string }): void {
  if (!isWeb || typeof document === "undefined") {
    throw new Error("Browser download is unavailable.");
  }
  const link = document.createElement("a");
  link.href = `data:${input.mimeType};base64,${input.data}`;
  link.download = input.fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function takeInitialAiCreationEditState(restoreEditSource: boolean): InitialAiCreationEditState {
  if (!restoreEditSource) {
    clearAiCreationEditSource();
    return createEmptyInitialAiCreationEditState();
  }

  const source = takeAiCreationEditSource();
  if (!source) {
    return createEmptyInitialAiCreationEditState();
  }
  return {
    mode: "edit",
    references: [{ ...source.image, fallbackPreviewUrl: source.previewUri }],
    previewUri: source.previewUri,
    imageSource: source.imageSource,
    sourceAgentId: source.sourceAgentId,
    sourceServerId: source.sourceServerId,
  };
}

function createEmptyInitialAiCreationEditState(): InitialAiCreationEditState {
  return {
    mode: "image",
    references: [],
    previewUri: null,
    imageSource: null,
    sourceAgentId: null,
    sourceServerId: null,
  };
}

function getConversationEditTitle(image: AttachmentMetadata | undefined): string {
  const fileName = image?.fileName?.trim();
  if (!fileName) {
    return translateNow("aiCreation.display.editPrefix");
  }
  return fileName.replace(/\.[A-Za-z0-9]+$/, "") || translateNow("aiCreation.display.editPrefix");
}

function buildAiCreationControlLabels(workspace: AiCreationWorkspace): Record<string, string> {
  if (!workspace.controlSessionId || !workspace.runtimeId || !workspace.nodeId) {
    return {};
  }
  return buildControlAgentLabels({
    sessionId: workspace.controlSessionId,
    runtimeId: workspace.runtimeId,
    nodeId: workspace.nodeId,
  });
}

async function appendAiCreationControlAgentBinding(input: {
  accountSession: AccountBootstrapSession;
  agentId: string;
  workspace: AiCreationWorkspace;
}): Promise<void> {
  if (!input.workspace.controlSessionId || !input.workspace.nodeId) {
    return;
  }
  await upsertControlAgentBinding({
    accountSession: input.accountSession,
    sessionId: input.workspace.controlSessionId,
    nodeId: input.workspace.nodeId,
    agentId: input.agentId,
    userWorkspaceId: input.workspace.userWorkspaceId ?? null,
    workspaceId: input.workspace.workspaceId,
    cwd: input.workspace.cwd,
  });
  await appendControlSessionMessage({
    accountSession: input.accountSession,
    sessionId: input.workspace.controlSessionId,
    role: "system",
    externalId: `agent:${input.agentId}:binding`,
    content: {
      kind: "control_agent_binding",
      nodeId: input.workspace.nodeId,
      agentId: input.agentId,
      workspaceId: input.workspace.workspaceId,
      workspaceDir: input.workspace.cwd,
    },
  });
  notifyControlSessionsChanged();
}

function findDirectHostRuntimeAuthToken(input: {
  endpoint: string;
  hosts: ReturnType<typeof useHosts>;
  serverId: string;
}): string | null {
  const host = input.hosts.find((entry) => entry.serverId === input.serverId);
  if (!host) {
    return null;
  }
  const normalizedEndpoint = normalizeHostPort(input.endpoint);
  const connection = host.connections.find(
    (entry) =>
      entry.type === "directTcp" && normalizeHostPort(entry.endpoint) === normalizedEndpoint,
  );
  return connection?.type === "directTcp" ? (connection.password ?? null) : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureRuntimeClientForNode(input: {
  node: ControlSchedulerDaemonNodeRecord;
  hosts: ReturnType<typeof useHosts>;
}): Promise<DaemonClient | null> {
  const store = getHostRuntimeStore();
  const existing = store.getSnapshot(input.node.id);
  if (existing?.connectionStatus === "online" && existing.client) {
    return existing.client;
  }

  const directEndpoint = resolveControlRuntimeDirectEndpoint(input.node.endpoint);
  await store.upsertDirectConnection({
    serverId: input.node.id,
    endpoint: directEndpoint.endpoint,
    useTls: directEndpoint.useTls,
    label: input.node.id,
    password: findDirectHostRuntimeAuthToken({
      endpoint: directEndpoint.endpoint,
      hosts: input.hosts,
      serverId: input.node.id,
    }),
  });
  await store.ensureStarted(input.node.id);

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const snapshot = store.getSnapshot(input.node.id);
    if (snapshot?.connectionStatus === "online" && snapshot.client) {
      return snapshot.client;
    }
    await delay(150);
  }
  return null;
}

async function createAiCreationWorkspace(
  input: CreateAiCreationWorkspaceInput,
): Promise<AiCreationWorkspace> {
  if (!input.accountSession) {
    throw new Error(translateNow("aiCreation.error.loginRequired"));
  }
  if (
    isControlApiConfigured() &&
    input.accountSession.workspace.workspaceId.startsWith("control:")
  ) {
    const selection = await selectControlRuntimeNode({
      accountSession: input.accountSession,
      providerId: input.agentConfig.provider,
      modelId: input.agentConfig.model ?? null,
    });
    const runtimeClient = await ensureRuntimeClientForNode({
      node: selection.node,
      hosts: input.hosts,
    });
    if (!runtimeClient) {
      throw new Error(translateNow("openProject.error.openProjectDaemon"));
    }
    const workingContext = { type: "generated_workspace" } as const;
    const userWorkspace = await ensureControlUserDaemonWorkspace({
      accountSession: input.accountSession,
      nodeId: selection.node.id,
    });
    const controlSession = await createControlSession({
      accountSession: input.accountSession,
      title: input.displayName,
      workingContext,
    });
    notifyControlSessionsChanged();
    await appendControlSessionMessage({
      accountSession: input.accountSession,
      sessionId: controlSession.id,
      role: "user",
      content: {
        text: input.initialPrompt,
        workingContext,
        agentConfig: input.agentConfig,
        surface: "ai_creation",
      },
    });
    const sessionWorkDir = await allocateControlSessionWorkDir({
      accountSession: input.accountSession,
      sessionId: controlSession.id,
      nodeId: selection.node.id,
      runtimeId: `rt_${controlSession.id}`,
      providerId: input.agentConfig.provider,
      modelId: input.agentConfig.model ?? null,
      selectionReason: selection.selectionReason,
    });
    const payload = await runtimeClient.openProject(sessionWorkDir.runtime.workspaceDir);
    if (payload.error || !payload.workspace) {
      throw new Error(payload.error ?? translateNow("aiCreation.error.createWorkspace"));
    }
    const workspace = normalizeWorkspaceDescriptor(payload.workspace);
    input.mergeWorkspaces(selection.node.id, [workspace]);
    input.setHasHydratedWorkspaces(selection.node.id, true);
    const cwd = workspace.workspaceDirectory.trim();
    if (!cwd) {
      throw new Error(translateNow("aiCreation.error.missingWorkspaceDirectory"));
    }
    return {
      cwd,
      workspaceId: workspace.id,
      client: runtimeClient,
      controlSessionId: controlSession.id,
      runtimeId: sessionWorkDir.runtime.runtimeId,
      nodeId: selection.node.id,
      userWorkspaceId: userWorkspace.id,
    };
  }
  if (!input.client) {
    throw new Error(translateNow("openProject.error.openProjectDaemon"));
  }
  const project = await createAccountProject({
    userId: input.accountSession.user.userId,
    workspaceId: input.accountSession.workspace.workspaceId,
    accessToken: input.accountSession.accessToken,
    displayName: input.displayName,
  });
  const nextSession = {
    ...input.accountSession,
    projects: [
      ...input.accountSession.projects.filter((item) => item.projectId !== project.projectId),
      project,
    ],
  };
  await saveAccountBootstrapSession(nextSession);

  const payload = await input.client.openProject(project.cwd);
  if (payload.error || !payload.workspace) {
    throw new Error(payload.error ?? translateNow("aiCreation.error.createWorkspace"));
  }

  const workspace = applyAccountProjectDisplay({
    workspace: normalizeWorkspaceDescriptor(payload.workspace),
    session: nextSession,
    project,
  });
  input.mergeWorkspaces(input.serverId, [workspace]);
  input.setHasHydratedWorkspaces(input.serverId, true);

  const cwd = workspace.workspaceDirectory.trim();
  if (!cwd) {
    throw new Error(translateNow("aiCreation.error.missingWorkspaceDirectory"));
  }
  return { cwd, workspaceId: workspace.id, client: input.client };
}

function buildAiCreationPrompt(input: {
  messageId: string;
  mode: CreationMode;
  prompt: string;
  defaultLocale: Locale;
  ratio: AspectRatio;
  style: VisualStyle;
  referenceCount: number;
  extraImageCount: number;
  hasSelectionGuide: boolean;
}): string {
  const baseInput = {
    messageId: input.messageId,
    mode: input.mode,
    prompt: input.prompt,
  };
  if (input.mode === "edit") {
    return buildAiCreationMarkupPrompt({
      ...baseInput,
      ratio: input.ratio,
      sourceCount: input.extraImageCount + 1,
      defaultLocale: input.defaultLocale,
      aiInstructions: buildImageEditPrompt({
        prompt: input.prompt,
        ratio: input.ratio,
        style: input.style,
        extraImageCount: input.extraImageCount,
        hasSelectionGuide: input.hasSelectionGuide,
      }),
    });
  }
  if (input.mode === "slides") {
    return buildAiCreationMarkupPrompt({
      ...baseInput,
      ratio: input.ratio,
      sourceCount: input.referenceCount,
      includeExpectedTarget: false,
      defaultLocale: input.defaultLocale,
      aiInstructions: buildSlidesPrompt({
        prompt: input.prompt,
        ratio: input.ratio,
        sourceFileCount: input.referenceCount,
        defaultLocale: input.defaultLocale,
      }),
    });
  }
  if (input.mode === "pdf") {
    return buildAiCreationMarkupPrompt({
      ...baseInput,
      sourceCount: input.referenceCount,
      defaultLocale: input.defaultLocale,
      aiInstructions: buildDocumentCreationPrompt({
        kind: "pdf",
        prompt: input.prompt,
        sourceFileCount: input.referenceCount,
      }),
    });
  }
  if (input.mode === "word") {
    return buildAiCreationMarkupPrompt({
      ...baseInput,
      sourceCount: input.referenceCount,
      defaultLocale: input.defaultLocale,
      aiInstructions: buildDocumentCreationPrompt({
        kind: "word",
        prompt: input.prompt,
        sourceFileCount: input.referenceCount,
      }),
    });
  }
  if (input.mode === "spreadsheet") {
    return buildAiCreationMarkupPrompt({
      ...baseInput,
      sourceCount: input.referenceCount,
      defaultLocale: input.defaultLocale,
      aiInstructions: buildDocumentCreationPrompt({
        kind: "spreadsheet",
        prompt: input.prompt,
        sourceFileCount: input.referenceCount,
      }),
    });
  }
  return buildAiCreationMarkupPrompt({
    ...baseInput,
    ratio: input.ratio,
    style: STYLE_PROMPT_LABELS[input.style],
    sourceCount: input.referenceCount,
    defaultLocale: input.defaultLocale,
    aiInstructions: buildImagegenPrompt({
      prompt: input.prompt,
      ratio: input.ratio,
      style: input.style,
      referenceCount: input.referenceCount,
    }),
  });
}

function buildAiCreationMarkupPrompt(input: {
  messageId: string;
  mode: CreationMode;
  prompt: string;
  aiInstructions: string;
  defaultLocale: Locale;
  ratio?: AspectRatio;
  style?: string;
  sourceCount?: number;
  includeExpectedTarget?: boolean;
}): string {
  const config = getAiCreationMarkupConfig(input.mode);
  const escapedMessageId = escapeDoyaMarkupText(input.messageId);
  const escapedPrompt = escapeDoyaMarkupText(input.prompt);
  const languageInstruction = buildDoyaResponseLanguageInstruction({
    defaultLocale: input.defaultLocale,
    userText: input.prompt,
  });
  const expectedTarget =
    input.includeExpectedTarget === false
      ? ""
      : `
<doya-expected-target
  version="1"
  kind="${config.kind}"
  goal="${config.goal}"
  id="${escapedMessageId}"
  text="${config.targetText}"
  desc="Exact target handshake that the assistant must emit before doing any work."
/>
`;
  const fields = [
    `<doya-field name="request" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.request"))}" desc="Original user creation request.">${escapedPrompt}</doya-field>`,
    input.ratio
      ? `<doya-field name="ratio" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.ratio"))}" desc="Requested output aspect ratio.">${escapeDoyaMarkupText(input.ratio)}</doya-field>`
      : null,
    input.style
      ? `<doya-field name="style" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.style"))}" desc="Requested visual style.">${escapeDoyaMarkupText(input.style)}</doya-field>`
      : null,
    typeof input.sourceCount === "number" && input.sourceCount > 0
      ? `<doya-field name="source_count" label="${escapeDoyaMarkupText(translateNow("aiCreation.markup.field.sourceCount"))}" desc="Number of attached source files or images.">${input.sourceCount}</doya-field>`
      : null,
  ].filter((field): field is string => Boolean(field));

  return `${buildDoyaMessageMeta()}

${config.normalInstruction}
${expectedTarget}
<doya-ui
  version="1"
  kind="${config.kind}"
  render="card"
  visibility="summary"
  id="${escapedMessageId}"
  desc="${config.cardDesc}"
>
  <doya-ui-content desc="User-visible card content. Doya may render this instead of the full prompt.">
    <doya-title desc="Title shown in the user message card.">${config.title}</doya-title>
    <doya-summary desc="Short user-visible summary of this task.">${escapedPrompt}</doya-summary>
    ${fields.join("\n    ")}
  </doya-ui-content>

  <doya-ai desc="Task instructions the AI must follow. Doya may hide this section from the chat UI.">
${escapeDoyaMarkupText(languageInstruction)}

${escapeDoyaMarkupText(input.aiInstructions)}
  </doya-ai>

  <doya-reply desc="Preferred response format. Doya may render a matching result block specially.">
Follow the final reply requirements in <doya-ai>. Preserve the request id "${escapedMessageId}" if you emit a matching result block.
  </doya-reply>
</doya-ui>`;
}

function getAiCreationMarkupConfig(mode: CreationMode): {
  kind: string;
  goal: string;
  targetText: string;
  title: string;
  normalInstruction: string;
  cardDesc: string;
} {
  if (mode === "edit") {
    return {
      kind: "ai_creation.image.edit",
      goal: "edit_image",
      targetText: translateNow("aiCreation.display.editPrefix"),
      title: translateNow("aiCreation.display.editPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.edit"),
      cardDesc: "A Doya-renderable task card for an AI image editing request.",
    };
  }
  if (mode === "slides") {
    return {
      kind: "ai_creation.slides.create",
      goal: "create_pptx",
      targetText: translateNow("aiCreation.display.slidesPrefix"),
      title: translateNow("aiCreation.display.slidesPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.slides"),
      cardDesc: "A Doya-renderable task card for an AI slide deck creation request.",
    };
  }
  if (mode === "pdf") {
    return {
      kind: "ai_creation.document.pdf.create",
      goal: "create_pdf",
      targetText: translateNow("aiCreation.display.pdfPrefix"),
      title: translateNow("aiCreation.display.pdfPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.pdf"),
      cardDesc: "A Doya-renderable task card for an AI PDF creation request.",
    };
  }
  if (mode === "word") {
    return {
      kind: "ai_creation.document.word.create",
      goal: "create_docx",
      targetText: translateNow("aiCreation.display.wordPrefix"),
      title: translateNow("aiCreation.display.wordPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.word"),
      cardDesc: "A Doya-renderable task card for an AI Word document creation request.",
    };
  }
  if (mode === "spreadsheet") {
    return {
      kind: "ai_creation.spreadsheet.create",
      goal: "create_spreadsheet",
      targetText: translateNow("aiCreation.display.spreadsheetPrefix"),
      title: translateNow("aiCreation.display.spreadsheetPrefix"),
      normalInstruction: translateNow("aiCreation.markup.instruction.spreadsheet"),
      cardDesc: "A Doya-renderable task card for an AI spreadsheet creation request.",
    };
  }
  return {
    kind: "ai_creation.image.generate",
    goal: "generate_image",
    targetText: translateNow("aiCreation.display.createPrefix"),
    title: translateNow("aiCreation.display.createPrefix"),
    normalInstruction: translateNow("aiCreation.markup.instruction.create"),
    cardDesc: "A Doya-renderable task card for an AI image generation request.",
  };
}

function buildDocumentCreationPrompt(input: {
  kind: "pdf" | "word" | "spreadsheet";
  prompt: string;
  sourceFileCount: number;
}): string {
  const config = {
    pdf: {
      surface: "PDF document",
      skill: "PDF/document generation",
      output: "PDF",
      directory: "output/documents/",
      extension: ".pdf",
      example: "[output/documents/report.pdf](output/documents/report.pdf)",
    },
    word: {
      surface: "Word document",
      skill: "document generation",
      output: "DOCX",
      directory: "output/documents/",
      extension: ".docx",
      example: "[output/documents/report.docx](output/documents/report.docx)",
    },
    spreadsheet: {
      surface: "spreadsheet",
      skill: "spreadsheet generation",
      output: "XLSX workbook",
      directory: "output/spreadsheets/",
      extension: ".xlsx",
      example: "[output/spreadsheets/workbook.xlsx](output/spreadsheets/workbook.xlsx)",
    },
  }[input.kind];
  const lines = [
    `You are creating a ${config.surface} for the Doya AI Creation surface.`,
    `Use the agent's available built-in ${config.skill} skill or workflow. Codex and Claude Code both have default capabilities for this artifact type; choose the appropriate one for the current provider.`,
    "This is an AI creation surface. Do not explain your reasoning, workflow, skill usage, shell commands, or implementation steps in the final conversation.",
    "If you must send progress text while creating, keep it to one short user-facing sentence in Chinese.",
    "",
    "User request:",
    input.prompt,
    "",
    `Source file count: ${input.sourceFileCount}`,
    "If source files are attached, the daemon writes them into `attachments/` and includes their paths in the structured attachment text. Use those workspace paths as source materials.",
    "",
    `Create a real ${config.output} file, not a screenshot or placeholder.`,
    `Write the final file under \`${config.directory}\` with a \`${config.extension}\` extension.`,
    "Use a clear, filesystem-safe file name based on the user's request.",
    "When the final file is saved, reply with Markdown file-link syntax only, using the workspace-relative path.",
    `Example final reply: ${config.example}`,
  ];
  return lines.join("\n");
}

function buildSlidesPrompt(input: {
  prompt: string;
  ratio: AspectRatio;
  sourceFileCount: number;
  defaultLocale: Locale;
}): string {
  const format = input.ratio === "4:3" ? "ppt43" : "ppt169";
  const previewReadyTitle = translate(
    "aiCreation.progress.slidesPreviewReady",
    input.defaultLocale,
  );
  const slideReadyTitle = translate("aiCreation.progress.slidesPageReady", input.defaultLocale, {
    number: 1,
  });
  const coverReadySummary = translate("aiCreation.progress.slidesCoverReady", input.defaultLocale);
  const lines = [
    "You are creating a PowerPoint deck for the Doya AI Creation slides surface.",
    "Doya has already prepared the bundled PPT Master skill link at `.doya/skills/ppt-master` before this agent starts.",
    "This is an AI creation surface. Keep user-facing progress minimal.",
    "Do not narrate skill reading, dependency installation, shell commands, file inspection, design reasoning, or implementation steps.",
    'Human-visible progress protocol: before the final reply, only send progress by emitting a `<doya-ui kind="ai_creation.slides.progress">` block.',
    "Only mark information as human-visible when it helps the user follow PPT creation: confirmation readiness, preview readiness, deck outline, design direction, source processing, each slide becoming ready, export start, or PPTX readiness.",
    "Do not expose implementation details in human-visible progress: no SVG, .svg filenames, shell commands, script names, dependency names, or internal file inspection.",
    "All human-visible progress titles and summaries must follow the response-language instruction above. Do not copy English titles such as `Slide 1 ready`, `Deck outline ready`, or `Preview ready` when the response language is Chinese.",
    "Use this protocol shape for progress:",
    `<doya-ui version="1" kind="ai_creation.slides.progress" render="status" visibility="summary" desc="Human-visible PPT creation progress."><doya-ui-content desc="Visible progress content."><doya-title desc="Progress title.">${slideReadyTitle}</doya-title><doya-summary desc="Progress summary.">${coverReadySummary}</doya-summary></doya-ui-content></doya-ui>`,
    "For preview readiness, include the preview path in a field named `preview_path` inside the same progress block.",
    "Do not search for PPT Master in other directories.",
    "Do not use web search for PPT Master.",
    "Do not git clone, fetch, or download PPT Master.",
    'If `.doya/skills/ppt-master/SKILL.md` is missing, stop immediately and reply exactly: "PPT Master skill link missing: .doya/skills/ppt-master/SKILL.md".',
    "Read `.doya/skills/ppt-master/SKILL.md` and follow that workflow exactly.",
    "Begin the PPT Master workflow immediately. Do not wait for a target handshake, confirmation, or user reply before creating the project.",
    "Doya provides its own built-in slide preview service. Do not run PPT Master's `scripts/svg_editor/server.py`, do not start Flask, and do not open localhost preview ports yourself.",
    "Doya also provides its own built-in Confirm UI. When PPT Master Step 4 asks you to run `scripts/confirm_ui/server.py`, do not run that local server, do not start Flask, and do not open localhost confirmation ports.",
    "Instead, write `projects/<project>/confirm_ui/recommendations.json`, then send a human-visible progress block with a `confirm_path` field set to `projects/<project>/confirm_ui/`. Doya will render the inline confirmation card in chat and write `projects/<project>/confirm_ui/result.json` when the user confirms.",
    "After sending the confirmation progress block, stop at the confirmation barrier. Until `projects/<project>/confirm_ui/result.json` exists or the user replies in chat with explicit choices, do not create the design spec, do not create `svg_output`, do not send a `preview_path`, do not generate slide SVGs, and do not continue to any later PPT Master step.",
    "When the confirmation barrier resolves, read `result.json` if it exists, honor the confirmed values exactly, and only then continue the PPT Master workflow.",
    `Streaming preview contract: after confirmation is resolved and project initialization creates \`projects/<project>/\`, ensure \`projects/<project>/svg_output/\` exists even if it is still empty, then immediately send a human-visible progress block titled \`${previewReadyTitle}\` with a \`preview_path\` field set to \`projects/<project>/svg_output/\`.`,
    "You must send the preview-ready progress block before generating or writing the first slide.",
    "After sending preview progress, continue the PPT Master workflow without waiting for the user.",
    "Write generated SVG pages into `projects/<project>/svg_output/` strictly one page at a time. Save `slide_01.svg` as soon as it is complete, then continue to `slide_02.svg`, and so on.",
    "Do not batch-generate all slide SVG files before writing them to disk. Do not wait until all slides are ready before exposing the preview directory.",
    `After each slide page is saved, send one human-visible progress block titled like \`${slideReadyTitle}\`, with a summary using the user-facing slide title, for example \`${coverReadySummary}\` Then continue with the next page.`,
    "Doya polls the preview directory and will show new slides as they appear.",
    "Treat tasteful animation as part of a finished AI-generated presentation, not as a user-only advanced option. Independently choose whether each deck should have page transitions, per-element entrance animation, or no motion based on the content, audience, and visual style.",
    "For most generated decks, export the final PPTX with subtle per-element animation enabled by passing `-a auto` to `svg_to_pptx.py`. Use `--animation-trigger after-previous` for click-free presentation flow unless the user explicitly asks for presenter-paced click reveals.",
    'When a slide has clear semantic sections, make sure the SVG uses top-level `<g id="...">` groups so PPT Master can animate meaningful regions such as title, chart, cards, timeline steps, image hero, and takeaway instead of animating tiny atoms. Keep chrome/background/header/footer groups named as chrome so they do not animate.',
    "If the deck is highly formal, print-oriented, compliance-heavy, or the user asks for no animation, keep element animation off and rely on the default page transition. If a specific reveal order matters, create and validate `animations.json` before export instead of relying only on `-a auto`.",
    "Only after the skill link exists, install Python requirements if needed: `pip install -r .doya/skills/ppt-master/requirements.txt`.",
    "",
    "User request:",
    input.prompt,
    "",
    `Canvas format: ${format}`,
    `Source file count: ${input.sourceFileCount}`,
    "If source files are attached, the daemon writes them into `attachments/` and includes their paths in the structured attachment text. Use those workspace paths as PPT Master source files.",
    "",
    "Run the PPT Master pipeline end to end:",
    "source_to_md -> project_manager init/import-sources -> Strategist design_spec/spec_lock -> sequential SVG pages -> svg_quality_checker -> total_md_split -> finalize_svg -> svg_to_pptx.",
    "",
    "The output must be a native editable PPTX in `projects/<project>/exports/`.",
    "Do not create a screenshot-only deck.",
    "Do not explain internal commands in the final reply unless a blocking error occurs.",
    "Final reply: only provide the PPTX path and optional preview path.",
  ];
  return lines.join("\n");
}

function buildImagegenPrompt(input: {
  prompt: string;
  ratio: AspectRatio;
  style: VisualStyle;
  referenceCount: number;
}): string {
  const lines = [
    "Use the Codex imagegen skill for this request. Follow the default built-in image_gen workflow unless the user explicitly asks for a CLI fallback.",
    "This is an AI creation surface. Do not explain your reasoning, workflow, skill usage, shell commands, or implementation steps in the final conversation.",
    "Reply only with the generated image result when available. If you must send text while generating, keep it to one short user-facing sentence in Chinese.",
    "",
    "Create a raster image from this prompt:",
    input.prompt,
    "",
    `Aspect ratio: ${input.ratio}`,
    `Style: ${STYLE_PROMPT_LABELS[input.style]}`,
    "Save the final image into the current workspace if a workspace-bound asset is produced.",
    "When the final image is saved, reply with Markdown image syntax only, using the workspace-relative path, for example: ![](assets/generated-image.png)",
  ];
  if (input.referenceCount > 0) {
    lines.push(
      `Reference images attached: ${input.referenceCount}. Treat them as visual references unless the user asks for an edit.`,
    );
  }
  return lines.join("\n");
}

function buildImageEditPrompt(input: {
  prompt: string;
  ratio: AspectRatio;
  style: VisualStyle;
  extraImageCount: number;
  hasSelectionGuide: boolean;
}): string {
  if (input.hasSelectionGuide) {
    const lines = [
      "Use the Codex imagegen skill for this guided image edit. Choose the appropriate image editing workflow yourself.",
      "This is an AI creation surface. Do not explain your reasoning, workflow, skill usage, shell commands, or implementation steps in the final conversation.",
      "Reply only with the edited image result when available. If you must send text while editing, keep it to one short user-facing sentence in Chinese.",
      "",
      "Edit the uploaded workspace source image with this instruction:",
      input.prompt,
      "",
      `Aspect ratio: ${input.ratio}`,
      `Style guidance: ${STYLE_PROMPT_LABELS[input.style]}`,
      "Use the structured uploaded-file attachment text to find workspace paths.",
      "`ai-edit-source.*` is the exact latest source image to edit.",
      "`ai-edit-selection-guide.png` is a visual guide image made from the source image with the user's selected region drawn over it in the user's chosen brush color. It is not the source image and must not be copied as the output.",
      "Use the guide only to understand the user's selected region; apply the requested change only around the colored brushed region while preserving the rest of the source image.",
      "Write the final image under `output/imagegen/` as a non-destructive PNG. Use `--force` only if retrying the same output path in this turn.",
      "Preserve all unrelated parts of the original image.",
      "Do not inspect temp attachment directories to choose a different image. Do not use any earlier image from the conversation as the edit source.",
      "When the final image is saved, reply with Markdown image syntax only, using the workspace-relative path, for example: ![](output/imagegen/edited-image.png)",
    ];
    if (input.extraImageCount > 0) {
      lines.splice(
        12,
        0,
        `Additional files named \`ai-edit-reference-*.*\` are reference images only. Use them only if the user asks to reference, match, compare, or borrow details. Reference image count: ${input.extraImageCount}.`,
      );
    }
    return lines.join("\n");
  }

  const lines = [
    "Use the Codex imagegen skill for this request. Follow the default built-in image_gen workflow unless the user explicitly asks for a CLI fallback.",
    "This is an AI creation surface. Do not explain your reasoning, workflow, skill usage, shell commands, or implementation steps in the final conversation.",
    "Reply only with the edited image result when available. If you must send text while editing, keep it to one short user-facing sentence in Chinese.",
    "",
    "Edit the attached image with this instruction:",
    input.prompt,
    "",
    `Aspect ratio: ${input.ratio}`,
    `Style guidance: ${STYLE_PROMPT_LABELS[input.style]}`,
    "Use the structured uploaded-file attachment text to find workspace paths when files are attached as workspace paths.",
    "`ai-edit-source.*` is the exact latest source image to edit.",
    "Do not inspect the temp attachment directory to choose a different image. Do not use any earlier image from the conversation as the edit source.",
    "Preserve all unrelated parts of the original image.",
    "Save the final image into the current workspace if a workspace-bound asset is produced.",
    "When the final image is saved, reply with Markdown image syntax only, using the workspace-relative path, for example: ![](assets/edited-image.png)",
  ];
  lines.splice(
    11,
    0,
    "No explicit selection guide is attached, so make the smallest visual change needed to satisfy the instruction.",
  );
  if (input.extraImageCount > 0) {
    lines.splice(
      13,
      0,
      `Additional files named \`ai-edit-reference-*.*\` are reference images only. Do not replace the edit source with them; use them only if the user asks to reference, match, compare, or borrow details from the uploaded image. Reference image count: ${input.extraImageCount}.`,
    );
  }
  return lines.join("\n");
}

function buildEditOptimisticImages(input: {
  image: AttachmentMetadata | null;
  extraImages: AttachmentMetadata[];
  excludeSourceImage?: boolean;
}): AttachmentMetadata[] {
  return input.image && !input.excludeSourceImage
    ? [input.image, ...input.extraImages]
    : input.extraImages;
}

function buildWorkspaceBackedUserImages(input: {
  images: AttachmentMetadata[];
  attachments: AgentAttachment[];
  cwd?: string;
}): UserMessageImageAttachment[] {
  if (input.images.length === 0 || input.attachments.length === 0) {
    return input.images;
  }

  const pathsByTitle = new Map<string, string>();
  for (const attachment of input.attachments) {
    if (attachment.type !== "text") continue;
    const title = attachment.title?.trim();
    const path = extractWorkspacePathFromAttachmentText(attachment.text);
    if (title && path) {
      pathsByTitle.set(title, path);
    }
  }

  return input.images.map((image, index) => {
    const extension = getAttachmentExtension(image);
    const path =
      (image.fileName ? pathsByTitle.get(image.fileName) : undefined) ??
      pathsByTitle.get(`ai-edit-reference-${index + 1}.${extension}`);
    if (!path) {
      return image;
    }

    return {
      kind: "workspace_image",
      id: image.id,
      ...(input.cwd ? { cwd: input.cwd } : {}),
      path,
      mimeType: image.mimeType,
      fileName: image.fileName,
      createdAt: image.createdAt,
    };
  });
}

function extractWorkspacePathFromAttachmentText(text: string | undefined): string | null {
  const match = text?.match(/^Workspace path:\s*(.+)$/m);
  return match?.[1]?.trim() || null;
}

function SelectionBrushToolbar({
  brushSize,
  color,
  canUndo,
  canRedo,
  canClear,
  onChangeBrushSize,
  onChangeColor,
  onUndo,
  onRedo,
  onClear,
}: {
  brushSize: number;
  color: string;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onChangeBrushSize: (size: number) => void;
  onChangeColor: (color: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  return (
    <View style={styles.selectionToolbar}>
      <View style={[styles.selectionBrushPreviewSmall, { backgroundColor: color }]} />
      <BrushSizeControl value={brushSize} onChange={onChangeBrushSize} />
      <View
        style={[
          styles.selectionBrushPreviewLarge,
          {
            backgroundColor: color,
            width: Math.round(brushSize / 3),
            height: Math.round(brushSize / 3),
            borderRadius: Math.round(brushSize / 6),
          },
        ]}
      />
      <View style={styles.selectionToolbarDivider} />
      <View style={styles.selectionColorSwatches}>
        {SELECTION_STROKE_COLORS.map((swatch) => {
          const selected = swatch.toLowerCase() === color.toLowerCase();
          return (
            <Pressable
              key={swatch}
              accessibilityRole="button"
              accessibilityLabel={t("aiCreation.selection.brushColor", { color: swatch })}
              onPress={() => onChangeColor(swatch)}
              style={[styles.selectionColorSwatch, selected && styles.selectionColorSwatchSelected]}
            >
              <View
                style={[
                  styles.selectionColorSwatchInner,
                  {
                    backgroundColor: swatch,
                    borderColor: swatch === "#FFFFFF" ? "#d4d4d8" : swatch,
                  },
                ]}
              />
            </Pressable>
          );
        })}
      </View>
      <View style={styles.selectionToolbarDivider} />
      <SelectionToolButton
        icon={Undo2}
        disabled={!canUndo}
        onPress={onUndo}
        accessibilityLabel={t("aiCreation.action.undoSelection")}
      />
      <SelectionToolButton
        icon={Redo2}
        disabled={!canRedo}
        onPress={onRedo}
        accessibilityLabel={t("aiCreation.action.redoSelection")}
      />
      <View style={styles.selectionToolbarDivider} />
      <Pressable
        style={styles.selectionClearButton}
        disabled={!canClear}
        onPress={onClear}
        accessibilityRole="button"
        accessibilityLabel={t("aiCreation.action.clearSelection")}
      >
        <Text style={[styles.selectionClearText, !canClear ? styles.selectionToolDisabled : null]}>
          {t("aiCreation.action.clear")}
        </Text>
      </Pressable>
    </View>
  );
}

function BrushSizeControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (size: number) => void;
}) {
  const { t } = useI18n();
  const [trackWidth, setTrackWidth] = useState(0);
  const progress =
    (value - SELECTION_BRUSH_SIZE_MIN) / (SELECTION_BRUSH_SIZE_MAX - SELECTION_BRUSH_SIZE_MIN);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);
  const updateFromLocation = useCallback(
    (locationX: number) => {
      if (trackWidth <= 0) return;
      const nextProgress = clamp(locationX / trackWidth, 0, 1);
      onChange(
        Math.round(
          SELECTION_BRUSH_SIZE_MIN +
            nextProgress * (SELECTION_BRUSH_SIZE_MAX - SELECTION_BRUSH_SIZE_MIN),
        ),
      );
    },
    [onChange, trackWidth],
  );
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          updateFromLocation(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event) => {
          updateFromLocation(event.nativeEvent.locationX);
        },
      }),
    [updateFromLocation],
  );
  return (
    <View
      style={styles.selectionBrushSlider}
      onLayout={handleLayout}
      accessibilityRole="adjustable"
      accessibilityLabel={t("aiCreation.action.brushSize")}
      {...panResponder.panHandlers}
    >
      <View style={styles.selectionBrushTrack} />
      <View
        style={[
          styles.selectionBrushTrackFill,
          { width: `${Math.round(clamp(progress, 0, 1) * 100)}%` },
        ]}
      />
      <View
        style={[
          styles.selectionBrushThumb,
          { left: `${Math.round(clamp(progress, 0, 1) * 100)}%` },
        ]}
      />
    </View>
  );
}

function SelectionToolButton({
  icon: Icon,
  disabled,
  onPress,
  accessibilityLabel,
}: {
  icon: typeof Undo2;
  disabled: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const { theme } = useUnistyles();
  return (
    <Pressable
      style={styles.selectionToolButton}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Icon
        size={theme.iconSize.md}
        color={disabled ? theme.colors.foregroundMuted : theme.colors.foreground}
      />
    </Pressable>
  );
}

function RatioDropdown({
  label,
  value,
  options,
  getLabel,
  onChange,
}: {
  label: string;
  value: AspectRatio;
  options: readonly AspectRatio[];
  getLabel: (value: AspectRatio) => string;
  onChange: (value: AspectRatio) => void;
}) {
  const [open, setOpen] = useState(false);
  const handleToggle = useCallback(() => setOpen((current) => !current), []);
  return (
    <View style={[styles.choiceGroup, open && styles.choiceGroupOpen]}>
      <Pressable
        style={({ hovered, pressed }) => choiceTriggerStyle({ hovered, pressed, open })}
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <RatioTriggerIcon />
        <Text style={styles.choiceTriggerText}>{label}</Text>
        <Text style={styles.choiceTriggerValue}>{value}</Text>
        {open ? (
          <ChevronUp size={16} color={AI_CREATION_CONTROL_ICON_COLOR} />
        ) : (
          <ChevronDown size={16} color={AI_CREATION_CONTROL_ICON_COLOR} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.ratioPopover}>
          <Text style={styles.choicePopoverTitle}>{label}</Text>
          {options.map((option) => {
            const selected = option === value;
            return (
              <Pressable
                key={option}
                style={({ hovered, pressed }) => choiceOptionStyle({ hovered, pressed, selected })}
                onPress={() => {
                  onChange(option);
                  setOpen(false);
                }}
                accessibilityRole="menuitem"
              >
                <RatioOptionIcon ratio={option} />
                <Text style={styles.choiceOptionText}>{getLabel(option)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function StyleDropdown({
  label,
  value,
  options,
  getLabel,
  onChange,
}: {
  label: string;
  value: VisualStyle;
  options: readonly VisualStyleOption[];
  getLabel: (option: VisualStyleOption) => string;
  onChange: (value: VisualStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const handleToggle = useCallback(() => setOpen((current) => !current), []);
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0] ?? STYLE_OPTIONS[0]!;
  return (
    <View style={[styles.choiceGroup, open && styles.choiceGroupOpen]}>
      <Pressable
        style={({ hovered, pressed }) => choiceTriggerStyle({ hovered, pressed, open })}
        onPress={handleToggle}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Palette size={16} color={AI_CREATION_CONTROL_ICON_COLOR} />
        <Text style={styles.choiceTriggerText}>{label}</Text>
        <Text style={styles.choiceTriggerValue}>{getLabel(selectedOption)}</Text>
        {open ? (
          <ChevronUp size={16} color={AI_CREATION_CONTROL_ICON_COLOR} />
        ) : (
          <ChevronDown size={16} color={AI_CREATION_CONTROL_ICON_COLOR} />
        )}
      </Pressable>
      {open ? (
        <View style={styles.stylePopover}>
          <Text style={styles.choicePopoverTitle}>{label}</Text>
          <ScrollView
            style={styles.styleOptionScroll}
            contentContainerStyle={styles.styleOptionScrollContent}
            showsVerticalScrollIndicator
            nestedScrollEnabled
          >
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  style={({ hovered, pressed }) =>
                    choiceOptionStyle({ hovered, pressed, selected })
                  }
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  accessibilityRole="menuitem"
                >
                  {option.source ? (
                    <Image source={option.source} style={styles.styleOptionImage} />
                  ) : (
                    <View style={styles.styleAutoImage}>
                      <Sparkles size={18} color={AI_CREATION_CONTROL_ICON_COLOR} />
                    </View>
                  )}
                  <Text style={styles.choiceOptionText}>{getLabel(option)}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

function RatioTriggerIcon() {
  return (
    <View style={styles.ratioTriggerIcon}>
      <View style={styles.ratioTriggerIconInset} />
    </View>
  );
}

function RatioOptionIcon({ ratio }: { ratio: AspectRatio }) {
  const [rawWidth, rawHeight] = ratio.split(":").map((part) => Number(part));
  const width = rawWidth || 1;
  const height = rawHeight || 1;
  const maxSide = 24;
  const scale = maxSide / Math.max(width, height);
  return (
    <View
      style={[
        styles.ratioOptionIcon,
        {
          width: Math.max(12, width * scale),
          height: Math.max(12, height * scale),
        },
      ]}
    />
  );
}

function ReferenceThumb({
  image,
  onRemove,
}: {
  image: AttachmentMetadata;
  onRemove: (id: string) => void;
}) {
  const uri = useAttachmentPreviewUrl(image);
  const handleRemove = useCallback(() => onRemove(image.id), [image.id, onRemove]);
  if (!image.mimeType.toLowerCase().startsWith("image/")) {
    return (
      <Pressable onPress={handleRemove} style={styles.fileReferenceChip} accessibilityRole="button">
        <Paperclip size={14} color="#6b7280" />
        <Text style={styles.fileReferenceText} numberOfLines={1}>
          {image.fileName || "Attachment"}
        </Text>
      </Pressable>
    );
  }
  if (!uri) {
    return <View style={styles.referenceThumbPlaceholder} />;
  }
  return (
    <Pressable onPress={handleRemove} style={styles.referenceThumb} accessibilityRole="button">
      <Image source={{ uri }} style={styles.referenceThumbImage} />
    </Pressable>
  );
}

function choiceTriggerStyle({
  hovered,
  pressed,
  open,
}: PressableStateCallbackType & { hovered?: boolean; open: boolean }) {
  return [
    styles.choiceTrigger,
    (open || Boolean(hovered)) && styles.choiceTriggerHovered,
    pressed && styles.choiceTriggerPressed,
  ];
}

function choiceOptionStyle({
  hovered,
  pressed,
  selected,
}: PressableStateCallbackType & { hovered?: boolean; selected: boolean }) {
  return [
    styles.choiceOption,
    selected && styles.choiceOptionSelected,
    Boolean(hovered) && styles.choiceOptionHovered,
    pressed && styles.choiceOptionPressed,
  ];
}

function modePillStyle({
  hovered,
  pressed,
  selected,
}: PressableStateCallbackType & { hovered?: boolean; selected: boolean }) {
  return [
    styles.modePill,
    selected && styles.modePillSelected,
    Boolean(hovered) && styles.modePillHovered,
    pressed && styles.modePillPressed,
  ];
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    backgroundColor: "#fcfcfc",
  },
  conversationEditRoot: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  conversationEditTopBar: {
    position: "relative",
    zIndex: 1100,
    minHeight: 64,
    borderBottomWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectionToolbar: {
    position: "relative",
    zIndex: 1090,
    minHeight: 48,
    borderBottomWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  selectionBrushPreviewSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: theme.borderWidth[2],
    borderColor: theme.colors.foreground,
  },
  selectionBrushPreviewLarge: {
    borderWidth: theme.borderWidth[2],
    borderColor: theme.colors.foreground,
    backgroundColor: "transparent",
  },
  selectionBrushSlider: {
    width: 150,
    height: 32,
    justifyContent: "center",
  },
  selectionBrushTrack: {
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  selectionBrushTrackFill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foreground,
  },
  selectionBrushThumb: {
    position: "absolute",
    width: 28,
    height: 28,
    marginLeft: -14,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface0,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    ...theme.shadow.md,
  },
  selectionToolbarDivider: {
    width: theme.borderWidth[1],
    height: 28,
    backgroundColor: theme.colors.border,
  },
  selectionColorSwatches: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  selectionColorSwatch: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: theme.borderWidth[1],
    borderColor: "transparent",
  },
  selectionColorSwatchSelected: {
    borderColor: theme.colors.foreground,
  },
  selectionColorSwatchInner: {
    width: 18,
    height: 18,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[1],
  },
  selectionToolButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  selectionClearButton: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: theme.spacing[2],
  },
  selectionClearText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  selectionToolDisabled: {
    color: theme.colors.foregroundMuted,
    opacity: theme.opacity[50],
  },
  conversationEditTopActions: {
    position: "relative",
    zIndex: 1110,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  conversationEditTopLeft: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  conversationEditTitle: {
    minWidth: 0,
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  conversationEditDivider: {
    width: theme.borderWidth[1],
    height: 32,
    backgroundColor: theme.colors.border,
    marginHorizontal: theme.spacing[1],
  },
  conversationEditIconButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationEditContent: {
    position: "relative",
    zIndex: 1,
    flex: 1,
    alignItems: "center",
    paddingHorizontal: theme.spacing[6],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[4],
    gap: theme.spacing[3],
    overflow: "hidden",
  },
  conversationEditStage: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: 1360,
    flex: 1,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationEditCanvas: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  conversationEditImageFrame: {
    position: "relative",
    overflow: "hidden",
  },
  conversationEditComposer: {
    width: "100%",
    maxWidth: 1120,
    flexShrink: 0,
    borderRadius: theme.borderRadius["2xl"],
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
    gap: theme.spacing[3],
  },
  conversationEditPromptInput: {
    minHeight: 44,
    maxHeight: 160,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
    ...(isWeb
      ? ({
          outlineStyle: "none",
          outlineWidth: 0,
          outlineColor: "transparent",
        } as object)
      : {}),
  },
  conversationEditComposerToolbar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing[2],
    justifyContent: "space-between",
    marginHorizontal: -6,
  },
  conversationEditSubmitButton: {
    width: 40,
    height: 40,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  conversationEditAddButton: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  conversationEditAddText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xl,
    lineHeight: theme.fontSize.xl * 1.2,
  },
  scrollContent: {
    alignItems: "center",
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: 28,
    paddingBottom: 210,
    backgroundColor: "#fcfcfc",
  },
  topBar: {
    height: HEADER_INNER_HEIGHT,
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "#00000012",
    backgroundColor: "#fcfcfc",
  },
  topBarIconGroup: {
    width: 160,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topBarIconBox: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  creationShell: {
    width: "100%",
    maxWidth: 1472,
    alignItems: "center",
  },
  creationHeader: {
    alignItems: "center",
    marginBottom: 30,
  },
  creationBody: {
    position: "relative",
    zIndex: 20,
    width: "100%",
    alignItems: "center",
  },
  creationMain: {
    position: "relative",
    zIndex: 20,
    width: "100%",
    maxWidth: 848,
    alignItems: "center",
    overflow: "visible",
  },
  title: {
    fontSize: 26,
    lineHeight: 36,
    fontWeight: theme.fontWeight.semibold,
    color: "#1f2937",
    letterSpacing: 0.22,
    ...(isWeb
      ? ({
          backgroundImage:
            "linear-gradient(90deg, #15803D 0%, #FACC15 28%, #0EA5E9 56%, #F97316 82%, #15803D 100%)",
          backgroundSize: "260% 100%",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          animation: `${AI_CREATION_TITLE_GRADIENT_ANIMATION_NAME} 7s ease-in-out infinite`,
        } as object)
      : {}),
  },
  subtitleTypewriterFrame: {
    position: "relative",
    marginTop: 9,
    minHeight: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  subtitleTypewriterLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: "#0000004d",
  },
  subtitleCaret: {
    marginLeft: 1,
    color: "#0000004d",
    fontSize: 16,
    lineHeight: 24,
  },
  subtitleMeasure: {
    opacity: 0,
    fontSize: 16,
    lineHeight: 24,
    color: "#0000004d",
  },
  composer: {
    position: "relative",
    zIndex: 1000,
    width: "100%",
    borderRadius: 24,
    borderWidth: theme.borderWidth[1],
    borderColor: "#00000014",
    backgroundColor: "#ffffff",
    paddingTop: 14,
    paddingRight: 14,
    paddingBottom: 12,
    paddingLeft: 14,
    gap: 10,
    ...theme.shadow.lg,
  },
  composerFocused: {
    borderColor: "#b9d7ff",
    shadowColor: "rgba(59, 130, 246, 0.22)",
  },
  promptInput: {
    color: "#000000d9",
    fontSize: 16,
    lineHeight: AI_CREATION_PROMPT_LINE_HEIGHT,
    padding: 0,
    ...(isWeb
      ? ({
          outlineStyle: "none",
          outlineWidth: 0,
          outlineColor: "transparent",
        } as object)
      : {}),
  },
  editStage: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: 1180,
    minHeight: 420,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
    overflow: "hidden",
  },
  editImageFrame: {
    width: "100%",
    maxWidth: 760,
    position: "relative",
    overflow: "hidden",
  },
  editImageFrameFallback: {
    minHeight: 320,
  },
  editImage: {
    width: "100%",
    height: "100%",
  },
  selectionOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  selectionCanvas: {
    width: "100%",
    height: "100%",
  },
  selectionStroke: {
    color: SELECTION_DEFAULT_STROKE_COLOR,
  },
  editUploadTarget: {
    minHeight: 320,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
  },
  editUploadIcon: {
    color: theme.colors.foregroundMuted,
  },
  editUploadText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  referenceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  referenceThumb: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  referenceThumbImage: {
    width: "100%",
    height: "100%",
  },
  fileReferenceChip: {
    maxWidth: 220,
    minHeight: 40,
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  fileReferenceText: {
    flexShrink: 1,
    fontSize: theme.fontSize.xs,
    color: theme.colors.foregroundMuted,
  },
  referenceThumbPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
  },
  toolbar: {
    position: "relative",
    zIndex: 1010,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 36,
    overflow: "visible",
  },
  toolbarLeft: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    overflow: "visible",
  },
  toolbarRight: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modePillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 32,
    borderRadius: 12,
    backgroundColor: "#0000000a",
    padding: 2,
    overflow: "hidden",
  },
  modePill: {
    width: 32,
    height: 28,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  modePillSelected: {
    backgroundColor: "#ffffff",
  },
  modePillHovered: {
    backgroundColor: "#ffffff",
  },
  modePillPressed: {
    opacity: 0.85,
  },
  modePillTooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.xs,
    lineHeight: theme.fontSize.xs * 1.4,
  },
  toolbarSpacer: {
    flexGrow: 1,
  },
  micButton: {
    width: 36,
    height: 36,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0000000a",
  },
  composerSubmitButton: {
    width: 36,
    height: 36,
    minWidth: 36,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  choiceGroup: {
    position: "relative",
    zIndex: 1,
  },
  choiceGroupOpen: {
    zIndex: 1190,
  },
  choiceTrigger: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: theme.spacing[1],
    backgroundColor: "transparent",
  },
  choiceTriggerHovered: {
    backgroundColor: "#0000000a",
  },
  choiceTriggerPressed: {
    opacity: 0.85,
  },
  choiceTriggerText: {
    fontSize: 14,
    lineHeight: 22,
    color: AI_CREATION_CONTROL_TEXT_COLOR,
  },
  choiceTriggerValue: {
    fontSize: 14,
    lineHeight: 22,
    color: AI_CREATION_CONTROL_MUTED_COLOR,
  },
  ratioTriggerIcon: {
    width: 16,
    height: 16,
    borderRadius: 5,
    borderWidth: 1.8,
    borderColor: AI_CREATION_CONTROL_ICON_COLOR,
    alignItems: "flex-end",
    justifyContent: "flex-end",
    padding: 2,
  },
  ratioTriggerIconInset: {
    width: 6,
    height: 6,
    borderTopWidth: 1.8,
    borderLeftWidth: 1.8,
    borderColor: AI_CREATION_CONTROL_ICON_COLOR,
    borderTopLeftRadius: 2,
  },
  ratioPopover: {
    position: "absolute",
    top: 42,
    left: 0,
    zIndex: 1200,
    borderRadius: 14,
    borderWidth: theme.borderWidth[1],
    borderColor: "#00000014",
    backgroundColor: theme.colors.surface0,
    padding: 4,
    minWidth: 262,
    ...theme.shadow.md,
  },
  stylePopover: {
    position: "absolute",
    top: 42,
    left: 0,
    zIndex: 1200,
    borderRadius: 14,
    borderWidth: theme.borderWidth[1],
    borderColor: "#00000014",
    backgroundColor: theme.colors.surface0,
    padding: 4,
    width: 254,
    maxHeight: 446,
    overflow: "hidden",
    ...theme.shadow.md,
  },
  choicePopoverTitle: {
    minHeight: 30,
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 10,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500",
    color: AI_CREATION_CONTROL_TITLE_COLOR,
  },
  styleOptionScroll: {
    maxHeight: 408,
  },
  styleOptionScrollContent: {
    paddingBottom: 4,
  },
  choiceOption: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "transparent",
  },
  choiceOptionHovered: {
    backgroundColor: "#0000000a",
  },
  choiceOptionSelected: {
    backgroundColor: "#0000000a",
  },
  choiceOptionPressed: {
    opacity: 0.85,
  },
  choiceOptionText: {
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 22,
    color: AI_CREATION_CONTROL_TEXT_COLOR,
  },
  ratioOptionIcon: {
    borderWidth: 2,
    borderColor: AI_CREATION_CONTROL_ICON_COLOR,
    borderRadius: 5,
  },
  styleOptionImage: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: "#f3f4f6",
  },
  styleAutoImage: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f1efff",
  },
  modelTrigger: {
    minHeight: 32,
    maxWidth: 180,
    paddingHorizontal: 8,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: theme.spacing[1.5],
    backgroundColor: "transparent",
  },
  modelTriggerText: {
    flexShrink: 1,
    fontSize: 14,
    color: AI_CREATION_CONTROL_TEXT_COLOR,
  },
  featureRow: {
    position: "relative",
    zIndex: 1,
    width: "100%",
    maxWidth: 848,
    height: 120,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingTop: 20,
    paddingBottom: 28,
    overflow: "hidden",
  },
  featureCardOuter: {
    height: 72,
    borderRadius: 12,
    padding: 1,
    overflow: "visible",
  },
  featureCard: {
    height: 70,
    borderRadius: 11,
    borderWidth: theme.borderWidth[1],
    borderColor: "#00000014",
    backgroundColor: "#f9fafb",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingLeft: 20,
    paddingRight: 12,
    shadowColor: "#000000",
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  featureCardText: {
    marginTop: 24,
    flexShrink: 0,
    minWidth: 42,
    color: "#000000d9",
    fontSize: 14,
    lineHeight: 21,
    letterSpacing: -0.15,
    fontWeight: theme.fontWeight.medium,
  },
  featureCardImage: {
    width: 56,
    height: 56,
    flexShrink: 0,
    marginTop: 7,
  },
  inspirationGrid: {
    position: "relative",
    zIndex: 0,
    width: "100%",
    maxWidth: 1472,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 2,
    overflow: "hidden",
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: 1,
  },
  inspirationColumn: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  inspirationTile: {
    position: "relative",
    width: "100%",
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "#0000000a",
  },
  inspirationImage: {
    width: "100%",
    height: "100%",
    borderRadius: 2,
    backgroundColor: "#0000000a",
  },
  inspirationOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 2,
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    ...(isWeb
      ? ({
          backgroundImage: "linear-gradient(180deg, #00000000 40%, #00000080 70%, #000000cc 100%)",
        } as object)
      : {}),
    padding: 16,
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 16,
  },
  inspirationOverlayHidden: {
    opacity: 0,
  },
  inspirationOverlayVisible: {
    opacity: 1,
  },
  inspirationPromptText: {
    width: "100%",
    maxHeight: 35,
    color: "#ffffffd9",
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0,
  },
  inspirationUseButton: {
    width: "100%",
    maxWidth: 216,
    minHeight: 36,
    borderRadius: 10,
    backgroundColor: "#f3f4f633",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
  },
  inspirationUseButtonActive: {
    backgroundColor: "#f3f4f64d",
  },
  inspirationUseButtonText: {
    color: "#ffffff",
    fontSize: 14,
    lineHeight: 22,
    letterSpacing: -0.15,
    fontWeight: "500",
  },
  inspirationFooter: {
    marginTop: 58,
    width: "100%",
    maxWidth: 1472,
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  inspirationFooterLine: {
    width: 154,
    height: 1,
    backgroundColor: "#0000001f",
  },
  inspirationFooterText: {
    height: 24,
    paddingHorizontal: 16,
    color: "#0000001f",
    fontSize: 16,
    lineHeight: 24,
  },
}));

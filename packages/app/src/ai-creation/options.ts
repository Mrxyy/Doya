import type { ImageSourcePropType } from "react-native";
import type { TranslationKey } from "@/i18n/translations";

export type AiCreationMode = "image" | "slides" | "pdf" | "word" | "spreadsheet" | "edit";
export type AiCreationSurfaceMode = Exclude<AiCreationMode, "edit">;
export type AiCreationAspectRatio = "1:1" | "2:3" | "3:4" | "4:3" | "9:16" | "16:9";
export type AiCreationVisualStyle =
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

export interface AiCreationVisualStyleOption {
  value: AiCreationVisualStyle;
  key: TranslationKey;
  source?: ImageSourcePropType;
}

export const AI_CREATION_RATIO_OPTIONS: readonly AiCreationAspectRatio[] = [
  "1:1",
  "2:3",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
];

export const AI_CREATION_SLIDE_RATIO_OPTIONS: readonly AiCreationAspectRatio[] = ["16:9", "4:3"];

export const AI_CREATION_RATIO_LABEL_KEYS: Record<AiCreationAspectRatio, TranslationKey> = {
  "1:1": "aiCreation.ratio.1_1",
  "2:3": "aiCreation.ratio.2_3",
  "3:4": "aiCreation.ratio.3_4",
  "4:3": "aiCreation.ratio.4_3",
  "9:16": "aiCreation.ratio.9_16",
  "16:9": "aiCreation.ratio.16_9",
};

export const AI_CREATION_STYLE_LABEL_KEYS: Record<AiCreationVisualStyle, TranslationKey> = {
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

export const AI_CREATION_STYLE_PROMPT_LABELS: Record<AiCreationVisualStyle, string> = {
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

export const AI_CREATION_STYLE_OPTIONS: readonly AiCreationVisualStyleOption[] = [
  { value: "auto", key: AI_CREATION_STYLE_LABEL_KEYS.auto },
  {
    value: "portrait",
    key: AI_CREATION_STYLE_LABEL_KEYS.portrait,
    source: require("../../assets/ai-creation-style-thumbnails/portrait.webp"),
  },
  {
    value: "cinematic",
    key: AI_CREATION_STYLE_LABEL_KEYS.cinematic,
    source: require("../../assets/ai-creation-style-thumbnails/cinematic.webp"),
  },
  {
    value: "chinese",
    key: AI_CREATION_STYLE_LABEL_KEYS.chinese,
    source: require("../../assets/ai-creation-style-thumbnails/chinese.webp"),
  },
  {
    value: "anime",
    key: AI_CREATION_STYLE_LABEL_KEYS.anime,
    source: require("../../assets/ai-creation-style-thumbnails/anime.webp"),
  },
  {
    value: "render3d",
    key: AI_CREATION_STYLE_LABEL_KEYS.render3d,
    source: require("../../assets/ai-creation-style-thumbnails/render3d.webp"),
  },
  {
    value: "cyberpunk",
    key: AI_CREATION_STYLE_LABEL_KEYS.cyberpunk,
    source: require("../../assets/ai-creation-style-thumbnails/cyberpunk.webp"),
  },
  {
    value: "cgAnimation",
    key: AI_CREATION_STYLE_LABEL_KEYS.cgAnimation,
    source: require("../../assets/ai-creation-style-thumbnails/cg-animation.webp"),
  },
  {
    value: "ink",
    key: AI_CREATION_STYLE_LABEL_KEYS.ink,
    source: require("../../assets/ai-creation-style-thumbnails/ink.webp"),
  },
  {
    value: "oil",
    key: AI_CREATION_STYLE_LABEL_KEYS.oil,
    source: require("../../assets/ai-creation-style-thumbnails/oil.webp"),
  },
  {
    value: "classic",
    key: AI_CREATION_STYLE_LABEL_KEYS.classic,
    source: require("../../assets/ai-creation-style-thumbnails/classic.webp"),
  },
  {
    value: "watercolor",
    key: AI_CREATION_STYLE_LABEL_KEYS.watercolor,
    source: require("../../assets/ai-creation-style-thumbnails/watercolor.webp"),
  },
  {
    value: "cartoon",
    key: AI_CREATION_STYLE_LABEL_KEYS.cartoon,
    source: require("../../assets/ai-creation-style-thumbnails/cartoon.webp"),
  },
  {
    value: "flatIllustration",
    key: AI_CREATION_STYLE_LABEL_KEYS.flatIllustration,
    source: require("../../assets/ai-creation-style-thumbnails/flat-illustration.webp"),
  },
  {
    value: "landscape",
    key: AI_CREATION_STYLE_LABEL_KEYS.landscape,
    source: require("../../assets/ai-creation-style-thumbnails/landscape.webp"),
  },
  {
    value: "hongKongAnime",
    key: AI_CREATION_STYLE_LABEL_KEYS.hongKongAnime,
    source: require("../../assets/ai-creation-style-thumbnails/hong-kong-anime.webp"),
  },
  {
    value: "pixel",
    key: AI_CREATION_STYLE_LABEL_KEYS.pixel,
    source: require("../../assets/ai-creation-style-thumbnails/pixel.webp"),
  },
  {
    value: "neon",
    key: AI_CREATION_STYLE_LABEL_KEYS.neon,
    source: require("../../assets/ai-creation-style-thumbnails/neon.webp"),
  },
  {
    value: "coloredPencil",
    key: AI_CREATION_STYLE_LABEL_KEYS.coloredPencil,
    source: require("../../assets/ai-creation-style-thumbnails/colored-pencil.webp"),
  },
  {
    value: "figurine",
    key: AI_CREATION_STYLE_LABEL_KEYS.figurine,
    source: require("../../assets/ai-creation-style-thumbnails/figurine.webp"),
  },
  {
    value: "kidsDrawing",
    key: AI_CREATION_STYLE_LABEL_KEYS.kidsDrawing,
    source: require("../../assets/ai-creation-style-thumbnails/kids-drawing.webp"),
  },
  {
    value: "abstract",
    key: AI_CREATION_STYLE_LABEL_KEYS.abstract,
    source: require("../../assets/ai-creation-style-thumbnails/abstract.webp"),
  },
  {
    value: "sharpIllustration",
    key: AI_CREATION_STYLE_LABEL_KEYS.sharpIllustration,
    source: require("../../assets/ai-creation-style-thumbnails/sharp-illustration.webp"),
  },
  {
    value: "acg",
    key: AI_CREATION_STYLE_LABEL_KEYS.acg,
    source: require("../../assets/ai-creation-style-thumbnails/acg.webp"),
  },
  {
    value: "inkPrint",
    key: AI_CREATION_STYLE_LABEL_KEYS.inkPrint,
    source: require("../../assets/ai-creation-style-thumbnails/ink-print.webp"),
  },
  {
    value: "printmaking",
    key: AI_CREATION_STYLE_LABEL_KEYS.printmaking,
    source: require("../../assets/ai-creation-style-thumbnails/printmaking.webp"),
  },
  {
    value: "monet",
    key: AI_CREATION_STYLE_LABEL_KEYS.monet,
    source: require("../../assets/ai-creation-style-thumbnails/monet.webp"),
  },
  {
    value: "picasso",
    key: AI_CREATION_STYLE_LABEL_KEYS.picasso,
    source: require("../../assets/ai-creation-style-thumbnails/picasso.webp"),
  },
  {
    value: "rembrandt",
    key: AI_CREATION_STYLE_LABEL_KEYS.rembrandt,
    source: require("../../assets/ai-creation-style-thumbnails/rembrandt.webp"),
  },
  {
    value: "matisse",
    key: AI_CREATION_STYLE_LABEL_KEYS.matisse,
    source: require("../../assets/ai-creation-style-thumbnails/matisse.webp"),
  },
  {
    value: "baroque",
    key: AI_CREATION_STYLE_LABEL_KEYS.baroque,
    source: require("../../assets/ai-creation-style-thumbnails/baroque.webp"),
  },
  {
    value: "retroAnime",
    key: AI_CREATION_STYLE_LABEL_KEYS.retroAnime,
    source: require("../../assets/ai-creation-style-thumbnails/retro-anime.webp"),
  },
  {
    value: "pictureBook",
    key: AI_CREATION_STYLE_LABEL_KEYS.pictureBook,
    source: require("../../assets/ai-creation-style-thumbnails/picture-book.webp"),
  },
];

export function aiCreationUsesWorkspaceFileReferences(mode: AiCreationMode): boolean {
  return mode === "slides" || mode === "pdf" || mode === "word" || mode === "spreadsheet";
}

export function aiCreationUsesAspectRatio(mode: AiCreationMode): boolean {
  return mode === "image" || mode === "edit" || mode === "slides";
}

export function getAiCreationRatioOptions(mode: AiCreationMode): readonly AiCreationAspectRatio[] {
  return mode === "slides" ? AI_CREATION_SLIDE_RATIO_OPTIONS : AI_CREATION_RATIO_OPTIONS;
}

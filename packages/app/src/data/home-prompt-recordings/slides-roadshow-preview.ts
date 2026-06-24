import slide01 from "./slides-roadshow/svg_output/01_封面.svg";
import slide02 from "./slides-roadshow/svg_output/02_痛点.svg";
import slide03 from "./slides-roadshow/svg_output/03_预算流向.svg";
import slide04 from "./slides-roadshow/svg_output/04_产品架构.svg";
import slide05 from "./slides-roadshow/svg_output/05_牵引力.svg";
import slide06 from "./slides-roadshow/svg_output/06_护城河.svg";
import slide07 from "./slides-roadshow/svg_output/07_GTM.svg";
import slide08 from "./slides-roadshow/svg_output/08_商业模型.svg";
import slide09 from "./slides-roadshow/svg_output/09_路线图.svg";
import slide10 from "./slides-roadshow/svg_output/10_融资请求.svg";

export interface HomePresetBundledSlidePreview {
  path: string;
  svg: unknown;
}

export const SlidesRoadshowPreviewSlides: readonly HomePresetBundledSlidePreview[] = [
  {
    path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/svg_output/01_封面.svg",
    svg: slide01,
  },
  {
    path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/svg_output/02_痛点.svg",
    svg: slide02,
  },
  {
    path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/svg_output/03_预算流向.svg",
    svg: slide03,
  },
  {
    path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/svg_output/04_产品架构.svg",
    svg: slide04,
  },
  {
    path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/svg_output/05_牵引力.svg",
    svg: slide05,
  },
  {
    path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/svg_output/06_护城河.svg",
    svg: slide06,
  },
  {
    path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/svg_output/07_GTM.svg",
    svg: slide07,
  },
  {
    path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/svg_output/08_商业模型.svg",
    svg: slide08,
  },
  {
    path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/svg_output/09_路线图.svg",
    svg: slide09,
  },
  {
    path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/svg_output/10_融资请求.svg",
    svg: slide10,
  },
] as const;

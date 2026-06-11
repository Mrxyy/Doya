import Svg, { Path, Rect } from "react-native-svg";

interface DoyaLogoProps {
  size?: number;
  color?: string;
}

export function DoyaLogo({ size = 64, color }: DoyaLogoProps) {
  const stem = color ?? "#246B3A";
  const leftLeaf = color ?? "#34B864";
  const rightLeaf = color ?? "#94D83D";
  const seed = color ?? "#D2A43B";

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect width={24} height={24} fill="#F3FFE8" />
      <Path d="M12 16.9V9.2" stroke={stem} strokeWidth={2.2} strokeLinecap="round" fill="none" />
      <Path d="M11.9 9.5C8.8 9.2 7 7.6 6.3 5.1c3.2-.3 5.2 1.1 6.2 3.8" fill={leftLeaf} />
      <Path d="M12.1 9.5c3.1-.3 4.9-1.9 5.6-4.4-3.2-.3-5.2 1.1-6.2 3.8" fill={rightLeaf} />
      <Path
        d="M8.3 18.1c0-2 1.6-3.5 3.7-3.5s3.7 1.5 3.7 3.5c0 1.2-1.1 1.9-3.7 1.9s-3.7-.7-3.7-1.9Z"
        fill={seed}
      />
    </Svg>
  );
}

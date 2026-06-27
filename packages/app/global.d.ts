declare module "*.css";

declare module "*.docx" {
  const asset: number;
  export default asset;
}

declare module "*.pdf" {
  const asset: number;
  export default asset;
}

declare module "*.pptx" {
  const asset: number;
  export default asset;
}

declare module "*.svg" {
  const content: string;
  export default content;
}

declare module "*.xlsx" {
  const asset: number;
  export default asset;
}

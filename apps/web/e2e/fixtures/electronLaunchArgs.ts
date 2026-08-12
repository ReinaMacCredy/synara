export function electronE2eLaunchArgs(
  mainPath: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === "linux" ? ["--no-sandbox", mainPath] : [mainPath];
}

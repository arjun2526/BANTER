declare module "qrcode" {
  export function toDataURL(text: string, opts?: object): Promise<string>;
  const qrcode: { toDataURL: (text: string, opts?: object) => Promise<string> };
  export default qrcode;
}

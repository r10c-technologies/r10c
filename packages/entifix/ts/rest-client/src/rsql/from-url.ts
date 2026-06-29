export const fromUrl = (url: string) => {
  const urlObj = new URL(url);
  const params = new URLSearchParams(urlObj.search);
  const rsql = params.get('rsql');
  return rsql || '';
};

export const toUrl = (rsql: string) => {
  const params = new URLSearchParams();
  params.set('rsql', rsql);
  return `?${params.toString()}`;
};

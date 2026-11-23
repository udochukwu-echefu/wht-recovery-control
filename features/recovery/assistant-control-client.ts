export async function readControlResponse<T>(response:Response):Promise<T> {
  const result = await response.json() as {error?:unknown};
  if (!response.ok) throw new Error(typeof result?.error === "string" ? result.error : "Assistant controls could not be loaded.");
  return result as T;
}

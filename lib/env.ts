export function getAppUrl(): string {
  const value = process.env.NEXT_PUBLIC_APP_URL;

  if (!value || value.trim() === "") {
    throw new Error(
      "Missing required environment variable: NEXT_PUBLIC_APP_URL",
    );
  }

  return value;
}

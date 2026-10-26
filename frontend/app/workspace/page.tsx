import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import WorkspaceClient from "./WorkspaceClient";

export default async function WorkspacePage() {
  const cookieStore = await cookies();
  if (!cookieStore.get("supa_deriv_access_token")?.value) redirect("/");
  return <WorkspaceClient />;
}

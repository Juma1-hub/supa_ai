import WorkspaceClient from "../workspace/WorkspaceClient";

// Public UI preview only. This route does not authenticate a Deriv account or enable trading.
export default function PreviewPage() {
  return <WorkspaceClient previewMode />;
}

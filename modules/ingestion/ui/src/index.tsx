import { defineModule } from "@kb/module-sdk";
import { Upload as UploadIcon } from "lucide-react";
import { Upload } from "./Upload.tsx";

export default defineModule({
  id: "ingestion",
  title: "Ingestion",
  icon: UploadIcon,
  routes: [{ index: true, element: <Upload /> }],
});

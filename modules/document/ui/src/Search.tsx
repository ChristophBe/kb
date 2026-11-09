import { Navigate, useLocation } from "react-router";

/**
 * The old document search page: documents are searched on the shell's search
 * page, so `/m/document/search?q=…` (bookmarks, shared links) opens `/search?q=…`.
 */
export function Search() {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: "/search", search, hash }} replace />;
}

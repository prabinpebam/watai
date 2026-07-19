import { createContext, useContext, type ReactNode } from 'react';
import { cloudApi } from '../../data';
import type { LibraryItemDTO, LibraryLineageResult, LibraryListQuery, LibraryListResult, LibraryStorageSummary } from '../../data/cloud/types';

export interface LibraryReadApi {
  listLibrary(query?: LibraryListQuery): Promise<LibraryListResult>;
  getLibraryItem(id: string): Promise<LibraryItemDTO>;
  getLibraryStorage(): Promise<LibraryStorageSummary>;
  getLibraryLineage(id: string, direction: 'references' | 'derived', cursor?: string): Promise<LibraryLineageResult>;
}

interface LibraryRuntime {
  api: LibraryReadApi;
  basePath: string;
  createImagePath: string;
}

const LibraryRuntimeContext = createContext<LibraryRuntime>({
  api: cloudApi,
  basePath: '/library',
  createImagePath: '/library/create/image',
});

export function LibraryRuntimeProvider({
  api,
  basePath = '/library',
  createImagePath = '/library/create/image',
  children,
}: {
  api: LibraryReadApi;
  basePath?: string;
  createImagePath?: string;
  children: ReactNode;
}) {
  return <LibraryRuntimeContext.Provider value={{ api, basePath, createImagePath }}>{children}</LibraryRuntimeContext.Provider>;
}

export function useLibraryRuntime(): LibraryRuntime {
  return useContext(LibraryRuntimeContext);
}

import { createContext, useContext, type ReactNode } from 'react';
import { cloudApi } from '../../data';
import type { LibraryItemDTO, LibraryLineageResult, LibraryListQuery, LibraryListResult, LibraryStorageSummary, LibraryUploadReservation } from '../../data/cloud/types';

export interface LibraryReadApi {
  listLibrary(query?: LibraryListQuery): Promise<LibraryListResult>;
  getLibraryItem(id: string): Promise<LibraryItemDTO>;
  getLibraryStorage(): Promise<LibraryStorageSummary>;
  getLibraryLineage(id: string, direction: 'references' | 'derived', cursor?: string): Promise<LibraryLineageResult>;
  reserveLibraryUpload(body: { name: string; mime: string; bytes: number; contentHash: string }): Promise<LibraryUploadReservation>;
  completeLibraryUpload(id: string, body: { bytes: number; contentHash: string }): Promise<LibraryItemDTO>;
}

interface LibraryRuntime {
  api: LibraryReadApi;
  basePath: string;
  createImagePath: string;
  newChatPath: (threadId: string) => string;
}

const LibraryRuntimeContext = createContext<LibraryRuntime>({
  api: cloudApi,
  basePath: '/library',
  createImagePath: '/library/create/image',
  newChatPath: (threadId) => `/c/${threadId}`,
});

export function LibraryRuntimeProvider({
  api,
  basePath = '/library',
  createImagePath = '/library/create/image',
  newChatPath = (threadId: string) => `/c/${threadId}`,
  children,
}: {
  api: LibraryReadApi;
  basePath?: string;
  createImagePath?: string;
  newChatPath?: (threadId: string) => string;
  children: ReactNode;
}) {
  return <LibraryRuntimeContext.Provider value={{ api, basePath, createImagePath, newChatPath }}>{children}</LibraryRuntimeContext.Provider>;
}

export function useLibraryRuntime(): LibraryRuntime {
  return useContext(LibraryRuntimeContext);
}

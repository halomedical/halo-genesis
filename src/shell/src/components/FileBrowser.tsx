import React from 'react';
import type { DriveFile, BreadcrumbItem } from '../../../../shared/types';
import { AppStatus, FOLDER_MIME_TYPE } from '../../../../shared/types';
import {
  FileText, ChevronLeft, ChevronRight, Home, FolderOpen, FolderPlus,
  Pencil, Trash2, Eye, ExternalLink, CloudUpload,
  FileSpreadsheet, FileImage, File,
} from 'lucide-react';
import { getFriendlyFileType } from '../utils/formatting';

interface FileBrowserProps {
  files: DriveFile[];
  status: AppStatus;
  breadcrumbs: BreadcrumbItem[];
  onNavigateToFolder: (folder: DriveFile) => void;
  onNavigateBack: () => void;
  onNavigateToBreadcrumb: (index: number) => void;
  onStartEditFile: (file: DriveFile) => void;
  onDeleteFile: (file: DriveFile) => void;
  onViewFile: (file: DriveFile) => void;
  onCreateFolder: () => void;
}

const isFolder = (file: DriveFile): boolean => file.mimeType === FOLDER_MIME_TYPE;

const FileSkeleton: React.FC = () => (
  <div className="space-y-3">
    <div className="flex items-center justify-center gap-2 py-4 text-slate-500">
      <div className="h-5 w-5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
      <span className="text-sm font-medium">Loading files...</span>
    </div>
    {[1, 2, 3].map((i) => (
      <div key={i} className="flex items-center p-3 bg-white border border-slate-200 rounded-2xl animate-pulse">
        <div className="w-10 h-10 bg-slate-200 rounded-2xl mr-3" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-slate-200 rounded w-2/3" />
          <div className="h-3 bg-slate-100 rounded w-1/3" />
        </div>
      </div>
    ))}
  </div>
);

/** Files that should never be shown in the doctor-facing folder view. */
function isHiddenSystemFile(file: DriveFile): boolean {
  const name = file.name.toLowerCase();
  // Hide internal JSON blobs (sessions, config, etc.)
  if (name.endsWith('.json')) return true;
  // Hide temp / scratch files
  if (name.startsWith('tmp') || name.startsWith('temp')) return true;
  // Hide known HALO system files
  if (name.startsWith('halo_') || name.startsWith('.halo')) return true;
  // Hide MIME-based JSON
  if (file.mimeType === 'application/json') return true;
  return false;
}

export const FileBrowser: React.FC<FileBrowserProps> = ({
  files, status, breadcrumbs,
  onNavigateToFolder, onNavigateBack, onNavigateToBreadcrumb,
  onStartEditFile, onDeleteFile, onViewFile, onCreateFolder,
}) => {
  const isAtRoot = breadcrumbs.length <= 1;
  const visibleFiles = files.filter(f => !isHiddenSystemFile(f));
  const folders = visibleFiles.filter(isFolder);
  const regularFiles = visibleFiles.filter(f => !isFolder(f));

  return (
    <div>
      {/* Breadcrumb navigation + New Folder button */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {!isAtRoot && (
            <button
              onClick={onNavigateBack}
              className="p-1.5 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors mr-1"
              title="Go back"
            >
              <ChevronLeft size={18} />
            </button>
          )}
          {breadcrumbs.map((crumb, index) => (
            <React.Fragment key={crumb.id}>
              {index > 0 && <ChevronRight size={14} className="text-slate-300 shrink-0" />}
              <button
                onClick={() => onNavigateToBreadcrumb(index)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  index === breadcrumbs.length - 1
                    ? 'text-sky-700 bg-sky-50'
                    : 'text-slate-500 hover:text-sky-600 hover:bg-slate-100'
                }`}
              >
                {index === 0 && <Home size={13} className="shrink-0" />}
                {index === 0 && breadcrumbs.length > 1 ? 'Root' : crumb.name}
              </button>
            </React.Fragment>
          ))}
        </div>
        <button
          onClick={onCreateFolder}
          className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-[#cfe3ef] bg-white px-3.5 text-sm font-semibold text-[#2f84b4] shadow-sm transition hover:border-[#9fd0e6] hover:bg-[#f2f9fd] hover:text-[#236f9b]"
        >
          <FolderPlus size={15} /> New Folder
        </button>
      </div>

      {/* File / folder listing */}
      <div className="grid grid-cols-1 gap-3">
        {status === AppStatus.LOADING ? (
          <FileSkeleton />
        ) : folders.length === 0 && regularFiles.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
            {status === AppStatus.UPLOADING ? (
              <div className="flex flex-col items-center gap-3">
                <CloudUpload className="w-12 h-12 text-sky-200 animate-bounce" />
                <p className="text-sky-600 font-medium">Adding file to drive...</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <FolderOpen className="w-10 h-10 text-slate-300" />
                <p className="text-slate-400 font-medium">This folder is empty</p>
                <p className="text-slate-300 text-sm">Upload files using the button above</p>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Folders first */}
            {folders.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-1 pt-1">
                  <FolderOpen size={13} className="text-slate-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Folders ({folders.length})</span>
                </div>
                {folders.map(folder => (
                  <div
                    key={folder.id}
                    className="group flex items-center rounded-2xl border border-slate-200 bg-white px-3.5 py-3 hover:border-sky-200 hover:bg-sky-50/40 transition-all duration-200 cursor-pointer"
                    onClick={() => onNavigateToFolder(folder)}
                  >
                    <div className="mr-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                      <FolderOpen className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-semibold text-slate-800 group-hover:text-sky-700 transition-colors truncate">{folder.name}</h4>
                      <p className="mt-0.5 text-[11px] text-slate-500">Folder - {folder.createdTime}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); onStartEditFile(folder); }}
                        className="rounded-xl p-2 text-slate-400 opacity-0 transition-colors hover:bg-white hover:text-sky-600 group-hover:opacity-100"
                        title="Rename"
                      >
                        <Pencil size={15} />
                      </button>
                      <ChevronRight size={17} className="text-slate-300 group-hover:text-sky-500 transition-colors" />
                    </div>
                  </div>
                ))}
              </>
            )}

            {/* Files */}
            {regularFiles.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-1 pt-2">
                  <FileText size={13} className="text-slate-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Files ({regularFiles.length})</span>
                </div>
                {regularFiles.map(file => {
                  const isImage = file.mimeType.includes('image');
                  const isSpreadsheet = file.mimeType.includes('spreadsheet') || file.mimeType.includes('excel') || file.mimeType.includes('csv');
                  const isPdf = file.mimeType === 'application/pdf';
                  const iconClass = isImage ? 'bg-purple-100 text-purple-600'
                    : isSpreadsheet ? 'bg-emerald-100 text-emerald-600'
                    : isPdf ? 'bg-red-100 text-red-600'
                    : 'bg-blue-100 text-blue-600';
                  const IconComponent = isImage ? FileImage
                    : isSpreadsheet ? FileSpreadsheet
                    : isPdf ? FileText
                    : File;
                  return (
                    <div key={file.id} className="group flex items-center rounded-2xl border border-slate-200 bg-white px-3.5 py-3 hover:border-sky-200 hover:bg-sky-50/40 transition-all duration-200">
                      <div className={`mr-3 flex h-10 w-10 items-center justify-center rounded-2xl ${iconClass}`}>
                        <IconComponent className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-slate-800 group-hover:text-sky-700 transition-colors truncate">{file.name}</h4>
                        <p className="mt-0.5 truncate text-[11px] text-slate-500">{file.createdTime} - {getFriendlyFileType(file.mimeType)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => onStartEditFile(file)} className="rounded-xl p-2 text-slate-400 opacity-0 transition-colors hover:bg-white hover:text-sky-600 group-hover:opacity-100" title="Rename">
                          <Pencil size={15} />
                        </button>
                        <button onClick={() => onDeleteFile(file)} className="rounded-xl p-2 text-slate-400 opacity-0 transition-colors hover:bg-rose-50 hover:text-rose-500 group-hover:opacity-100" title="Delete">
                          <Trash2 size={15} />
                        </button>
                        <button onClick={() => onViewFile(file)} className="hidden sm:flex h-9 items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-600 transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700" title="Preview">
                          <Eye size={14} /> View
                        </button>
                        <a href={file.url} target="_blank" rel="noreferrer" className="rounded-xl p-2 text-slate-400 opacity-0 transition-colors hover:bg-white hover:text-sky-600 group-hover:opacity-100" title="Open in new tab">
                          <ExternalLink size={15} />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

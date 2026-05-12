import * as m3u8 from "m3u8-parser";
import PQueue from "p-queue";
import * as path from "path";
import { download, get, HttpHeaders } from "./http";
import { ILogger } from "./Logger";
import { AxiosError } from "axios";

export interface IDownloadJob {
  uri: string;
  filename?: string;
  byterange?: m3u8.ByteRange;
}

export abstract class ChunksDownloader {
  protected queue: PQueue;

  protected resolve?: () => void;
  protected reject?: () => void;

  protected current = 0;
  protected total = 0;
  protected downloadedFiles: string[] = [];
  protected fragmentedMp4 = false;

  constructor(
    protected logger: ILogger,
    protected playlistUrl: string,
    protected concurrency: number,
    protected maxRetries: number,
    protected segmentDirectory: string,
    protected httpHeaders?: HttpHeaders,
    protected onStartCallback?: (totalSegments: number) => void | null,
    protected onProgressCallback?: (current: number, total: number) => void | null,
    protected onEndCallback?: () => void | null
  ) {
    this.queue = new PQueue({
      concurrency: this.concurrency,
    });
  }

  public start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;

      this.queue.add(() => this.refreshPlayList());
    });
  }

  protected abstract refreshPlayList(): Promise<void>;

  public getDownloadedFiles(): string[] {
    return this.downloadedFiles.filter(Boolean);
  }

  public isFragmentedMp4(): boolean {
    return this.fragmentedMp4;
  }

  protected async loadPlaylist(): Promise<m3u8.Manifest> {
    const response = await get(this.playlistUrl, this.httpHeaders);

    const parser = new m3u8.Parser();
    parser.push(response);
    parser.end();

    return parser.manifest;
  }

  protected createDownloadJobs(segments: m3u8.ManifestSegment[], filenameOffset = 0): IDownloadJob[] {
    const hasByteRanges = segments.some((segment) => segment.byterange);
    const hasFragmentMetadata = segments.some((segment) => segment.map || this.hasFragmentExtension(segment.uri));
    const needsOrderedFilenames = hasFragmentMetadata || hasByteRanges;
    const jobs: IDownloadJob[] = [];
    let currentMapKey: string | undefined;

    this.fragmentedMp4 = hasFragmentMetadata;

    for (const segment of segments) {
      if (segment.map) {
        const mapUrl = new URL(segment.map.uri, this.playlistUrl).href;
        const mapKey = this.getJobKey(mapUrl, segment.map.byterange);

        if (mapKey !== currentMapKey) {
          jobs.push({
            uri: mapUrl,
            filename: needsOrderedFilenames ? this.createOrderedFilename(filenameOffset + jobs.length, mapUrl, "init") : undefined,
            byterange: segment.map.byterange,
          });
          currentMapKey = mapKey;
        }
      }

      const segmentUrl = new URL(segment.uri, this.playlistUrl).href;

      jobs.push({
        uri: segmentUrl,
        filename: needsOrderedFilenames ? this.createOrderedFilename(filenameOffset + jobs.length, segmentUrl, "segment") : undefined,
        byterange: segment.byterange,
      });
    }

    return jobs;
  }

  protected getSegmentIdentity(segment: m3u8.ManifestSegment): string {
    const segmentUrl = new URL(segment.uri, this.playlistUrl).href;
    return this.getJobKey(segmentUrl, segment.byterange);
  }

  protected async downloadSegment(job: IDownloadJob | string, order?: number): Promise<void> {
    const downloadJob = typeof job === "string" ? { uri: job } : job;
    const segmentUrl = downloadJob.uri;
    // Get filename from URL
    const question = segmentUrl.indexOf("?");
    let filename = question > 0 ? segmentUrl.substr(0, question) : segmentUrl;
    const slash = filename.lastIndexOf("/");
    filename = filename.substr(slash + 1);
    filename = downloadJob.filename || filename;
    const outputFile = path.join(this.segmentDirectory, filename);

    // Download file
    await this.downloadWithRetries(segmentUrl, outputFile, this.maxRetries, downloadJob.byterange);
    if (order !== undefined) {
      this.downloadedFiles[order] = outputFile;
    }
    this.logger.log("Received:", segmentUrl);
    this.current++;
    this.onProgressCallback && this.onProgressCallback(this.current, this.total);
  }

  private createOrderedFilename(index: number, url: string, label: string): string {
    const question = url.indexOf("?");
    let filename = question > 0 ? url.substr(0, question) : url;
    const slash = filename.lastIndexOf("/");
    filename = filename.substr(slash + 1);
    const ext = path.extname(filename) || ".m4s";
    return `${index.toString().padStart(8, "0")}-${label}${ext}`;
  }

  private getJobKey(url: string, byterange?: m3u8.ByteRange): string {
    if (!byterange) {
      return url;
    }

    return `${url}:${byterange.offset || 0}:${byterange.length}`;
  }

  private hasFragmentExtension(uri: string): boolean {
    const pathname = new URL(uri, this.playlistUrl).pathname.toLowerCase();
    return pathname.endsWith(".m4s") || pathname.endsWith(".mp4");
  }

  private getRangeHeader(byterange?: m3u8.ByteRange): HttpHeaders | undefined {
    if (!byterange) {
      return undefined;
    }

    const offset = byterange.offset || 0;
    return {
      Range: `bytes=${offset}-${offset + byterange.length - 1}`,
    };
  }

  private async downloadWithRetries(
    url: string,
    file: string,
    maxRetries: number,
    byterange?: m3u8.ByteRange,
    currentTry = 1
  ): Promise<void> {
    if (currentTry > maxRetries) {
      throw new Error("too many retries - download failed");
    }

    try {
      await download(url, file, { ...this.httpHeaders, ...this.getRangeHeader(byterange) });
    } catch (err) {
      if (err instanceof AxiosError) {
        const status = err.response?.status;
        switch (status) {
          case 429:
            this.logger.log("Rate limited, waiting 1 seconds");
            await new Promise((resolve) => setTimeout(resolve, 10000));
            break;
          default:
            this.logger.log("Error:", err.response?.status, err.response?.statusText);
        }
      } else {
        this.logger.log("Error:", err);
      }

      await this.downloadWithRetries(url, file, maxRetries, byterange, ++currentTry);
    }
  }
}

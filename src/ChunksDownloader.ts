import * as m3u8 from "m3u8-parser";
import PQueue from "p-queue";
import * as path from "path";
import { download, get, HttpHeaders } from "./http";
import { ILogger } from "./Logger";
import { AxiosError } from "axios";

export abstract class ChunksDownloader {
  protected queue: PQueue;

  protected resolve?: () => void;
  protected reject?: () => void;

  protected current = 0;
  protected total = 0;

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

  protected async loadPlaylist(): Promise<m3u8.Manifest> {
    const response = await get(this.playlistUrl, this.httpHeaders);

    const parser = new m3u8.Parser();
    parser.push(response);
    parser.end();

    return parser.manifest;
  }

  protected async downloadSegment(segmentUrl: string): Promise<void> {
    // Get filename from URL
    const question = segmentUrl.indexOf("?");
    let filename = question > 0 ? segmentUrl.substr(0, question) : segmentUrl;
    const slash = filename.lastIndexOf("/");
    filename = filename.substr(slash + 1);

    // Download file
    await this.downloadWithRetries(segmentUrl, path.join(this.segmentDirectory, filename), this.maxRetries);
    this.logger.log("Received:", segmentUrl);
    this.current++;
    this.onProgressCallback && this.onProgressCallback(this.current, this.total);
  }

  private async downloadWithRetries(url: string, file: string, maxRetries: number, currentTry = 1): Promise<void> {
    if (currentTry > maxRetries) {
      throw new Error("too many retries - download failed");
    }

    try {
      await download(url, file, this.httpHeaders);
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

      await this.downloadWithRetries(url, file, maxRetries, ++currentTry);
    }
  }
}

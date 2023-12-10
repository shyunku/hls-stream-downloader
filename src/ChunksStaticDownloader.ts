import { URL } from "url";
import { ChunksDownloader } from "./ChunksDownloader";
import { HttpHeaders } from "./http";
import { ILogger } from "./Logger";

export class ChunksStaticDownloader extends ChunksDownloader {
  constructor(
    logger: ILogger,
    playlistUrl: string,
    concurrency: number,
    maxRetries: number,
    segmentDirectory: string,
    httpHeaders?: HttpHeaders,
    onStartCallback?: (totalSegments: number) => void | null,
    onProgressCallback?: (uri: string) => void | null,
    onEndCallback?: () => void | null
  ) {
    super(
      logger,
      playlistUrl,
      concurrency,
      maxRetries,
      segmentDirectory,
      httpHeaders,
      onStartCallback,
      onProgressCallback,
      onEndCallback
    );
  }

  protected async refreshPlayList(): Promise<void> {
    const playlist = await this.loadPlaylist();
    const segments = playlist.segments!.map((s) => new URL(s.uri, this.playlistUrl).href);

    this.onStartCallback!(segments.length);
    this.logger.log(`Queueing ${segments.length} segment(s)`);
    for (const uri of segments) {
      this.queue.add(() => this.downloadSegment(uri));
    }

    this.queue.onIdle().then(() => this.finished());
  }

  private finished(): void {
    this.logger.log("All segments received, stopping");
    this.onEndCallback!();
    this.resolve!();
  }
}

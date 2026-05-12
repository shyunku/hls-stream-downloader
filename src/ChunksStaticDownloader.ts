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
        onProgressCallback?: (current: number, total: number) => void | null,
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
        const segments = this.createDownloadJobs(playlist.segments!);

        this.current = 0;
        this.total = segments.length;
        this.onStartCallback && this.onStartCallback(segments.length);
        this.logger.log(`Queueing ${segments.length} segment(s)`);
        segments.forEach((segment, index) => {
            this.queue.add(() => this.downloadSegment(segment, index));
        });

        this.queue.onIdle().then(() => this.finished());
    }

    private finished(): void {
        this.logger.log("All segments received, stopping");
        this.onEndCallback && this.onEndCallback();
        this.resolve!();
    }
}

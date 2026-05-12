import * as m3u8 from "m3u8-parser";
import { ChunksDownloader } from "./ChunksDownloader";
import { HttpHeaders } from "./http";
import { ILogger } from "./Logger";

export class ChunksLiveDownloader extends ChunksDownloader {
    private lastSegment?: string;

    private timeoutHandle?: NodeJS.Timeout;
    private refreshHandle?: NodeJS.Timeout;

    constructor(
        logger: ILogger,
        playlistUrl: string,
        concurrency: number,
        maxRetries: number,
    private fromEnd: number,
    segmentDirectory: string,
    private timeoutDuration: number = 60,
    private playlistRefreshInterval: number = 5,
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

        const interval = playlist.targetDuration || this.playlistRefreshInterval;
        const segments = playlist.segments!;
        const segmentKeys = segments.map((s) => this.getSegmentIdentity(s));

        this.current = 0;
        this.total = segmentKeys.length;
        this.onStartCallback && this.onStartCallback(segmentKeys.length);
        this.refreshHandle = setTimeout(() => this.refreshPlayList(), interval * 1000);

        let toLoad: m3u8.ManifestSegment[] = [];
        if (!this.lastSegment) {
            toLoad = segments.slice(segments.length - this.fromEnd);
        } else {
            const index = segmentKeys.indexOf(this.lastSegment);
            if (index < 0) {
                this.logger.error("Could not find last segment in playlist");
                toLoad = segments;
            } else if (index === segmentKeys.length - 1) {
                this.logger.log("No new segments since last check");
                return;
            } else {
                toLoad = segments.slice(index + 1);
            }
        }

        this.lastSegment = this.getSegmentIdentity(toLoad[toLoad.length - 1]);
        const startIndex = this.downloadedFiles.length;
        const jobs = this.createDownloadJobs(toLoad, startIndex);

        jobs.forEach((job, index) => {
            this.logger.log("Queued:", job.uri);
            this.queue.add(() => this.downloadSegment(job, startIndex + index));
        });

        // Timeout after X seconds without new segment
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
        }
        this.timeoutHandle = setTimeout(() => this.timeout(), this.timeoutDuration * 1000);
    }

    private timeout(): void {
        this.logger.log("No new segment for a while, stopping");
        if (this.refreshHandle) {
            clearTimeout(this.refreshHandle);
        }
        this.onEndCallback && this.onEndCallback();
        this.resolve!();
    }
}

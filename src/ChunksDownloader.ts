import * as m3u8 from "m3u8-parser";
import * as PQueue from "p-queue";
import { download, get } from "./http";

export class ChunksDownloader {
    private queue: PQueue;
    private lastSegment?: string;

    private resolve?: () => void;
    private reject?: () => void;

    constructor(
        private playlistUrl: string,
        private concurrency: number,
        private fromEnd: number,
        private segmentDirectory: string,
    ) {
        this.queue = new PQueue({
            concurrency: this.concurrency,
        });
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.queue.add(() => this.refreshPlayList());
        });
    }

    private async refreshPlayList(): Promise<void> {
        const playlist = await this.loadPlaylist();

        const interval = playlist.targetDuration || 5;
        const segments = playlist.segments!.map((s) => s.uri);

        let toLoad: string[] = [];
        if (!this.lastSegment) {
            toLoad = segments.slice(segments.length - this.fromEnd);
        } else {
            const index = segments.indexOf(this.lastSegment);
            if (index < 0) {
                console.error("wut wut missing segment");
                toLoad = segments;
            } else if (index === segments.length - 1) {
                console.log("finished?");
                return this.resolve!(); // TODO: wait X seconds to be sure we aren't just too fast
            } else {
                toLoad = segments.slice(index + 1);
            }
        }

        this.lastSegment = toLoad[toLoad.length - 1];
        for (const uri of toLoad) {
            console.log("Queued:", uri);
            this.queue.add(() => this.downloadSegment(uri));
        }

        setTimeout(() => this.refreshPlayList(), interval * 1000);
    }

    private async loadPlaylist(): Promise<m3u8.Manifest> {
        const response = await get(this.playlistUrl);

        const parser = new m3u8.Parser();
        parser.push(response);
        parser.end();

        return parser.manifest;
    }

    private async downloadSegment(segmentUrl: string): Promise<void> {
        // Get filename from URL
        const question = segmentUrl.indexOf("?");
        let filename = question > 0 ? segmentUrl.substr(0, question) : segmentUrl;
        const slash = filename.lastIndexOf("/");
        filename = filename.substr(slash + 1);

        // Download file
        await download(segmentUrl, this.segmentDirectory + filename);
        console.log("Received:", segmentUrl);
    }
}

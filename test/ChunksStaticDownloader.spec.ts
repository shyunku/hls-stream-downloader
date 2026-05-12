import * as fs from "fs";
import * as http from "../src/http";
import * as tempy from "tempy";
import { ChunksStaticDownloader } from "../src/ChunksStaticDownloader";

const PLAYLIST_URL = "https://test.com/playlist.m3u8"

const PLAYLIST = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:1101811
#EXTINF:1
segment1
#EXTINF:1
segment2
#EXTINF:1
segment3`;

const FMP4_PLAYLIST = `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MAP:URI="main.mp4",BYTERANGE="720@0"
#EXTINF:6
#EXT-X-BYTERANGE:100@720
main.mp4
#EXTINF:6
#EXT-X-BYTERANGE:200@820
main.mp4`;

jest.mock("../src/http", () => ({
    download: jest.fn(),
    get: jest.fn(),
}));

describe("ChunksStaticDownloader", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("Works properly", async () => {
        const logger = { log: jest.fn(), error: jest.fn() };

        (http.get as jest.Mock).mockReturnValue(PLAYLIST);
        (http.download as jest.Mock).mockImplementation((url: string, file: string) => {
            fs.writeFileSync(file, url + "\n");
        });

        const dir = tempy.directory();
        const downloader = new ChunksStaticDownloader(logger, PLAYLIST_URL, 1, 1, dir);
        await downloader.start();

        const files = fs.readdirSync(dir);
        expect(files).toEqual(["segment1", "segment2", "segment3"]);
    });

    it("Downloads fMP4 init maps and byte ranges in order", async () => {
        const logger = { log: jest.fn(), error: jest.fn() };

        (http.get as jest.Mock).mockReturnValue(FMP4_PLAYLIST);
        (http.download as jest.Mock).mockImplementation((url: string, file: string) => {
            fs.writeFileSync(file, url + "\n");
        });

        const dir = tempy.directory();
        const downloader = new ChunksStaticDownloader(logger, PLAYLIST_URL, 1, 1, dir);
        await downloader.start();

        const files = fs.readdirSync(dir);
        expect(files).toEqual(["00000000-init.mp4", "00000001-segment.mp4", "00000002-segment.mp4"]);
        expect(downloader.isFragmentedMp4()).toBe(true);
        expect(downloader.getDownloadedFiles().map((file) => file.replace(/\\/g, "/"))).toEqual([
            `${dir.replace(/\\/g, "/")}/00000000-init.mp4`,
            `${dir.replace(/\\/g, "/")}/00000001-segment.mp4`,
            `${dir.replace(/\\/g, "/")}/00000002-segment.mp4`,
        ]);
        expect(http.download).toHaveBeenNthCalledWith(1, "https://test.com/main.mp4", expect.any(String), {
            Range: "bytes=0-719",
        });
        expect(http.download).toHaveBeenNthCalledWith(2, "https://test.com/main.mp4", expect.any(String), {
            Range: "bytes=720-819",
        });
        expect(http.download).toHaveBeenNthCalledWith(3, "https://test.com/main.mp4", expect.any(String), {
            Range: "bytes=820-1019",
        });
    });
});

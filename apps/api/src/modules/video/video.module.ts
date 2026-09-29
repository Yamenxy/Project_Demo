import { Module, type OnModuleInit } from '@nestjs/common';
import { JobsRuntime } from '../../jobs';
import { ContentModule } from '../content';
import { VideoController } from './video.controller';
import { VideoService } from './video.service';

@Module({
  imports: [ContentModule],
  controllers: [VideoController],
  providers: [VideoService],
  exports: [VideoService],
})
export class VideoModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsRuntime,
    private readonly video: VideoService,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ workspaceId: string; videoId: string }>('video.transcode', (data) =>
      this.video.transcode(data.workspaceId, data.videoId),
    );
  }
}

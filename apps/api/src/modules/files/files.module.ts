import path from 'node:path';
import { Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { JobsRuntime } from '../../jobs';
import { ContentModule } from '../content';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileStorage, LocalDiskStorage } from './storage';

@Module({
  imports: [ContentModule],
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: FileStorage,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): FileStorage =>
        new LocalDiskStorage(path.resolve(config.storage.dir)),
    },
  ],
  exports: [FilesService],
})
export class FilesModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsRuntime,
    private readonly filesService: FilesService,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ workspaceId: string; fileId: string }>('files.scan', (data) =>
      this.filesService.scan(data.workspaceId, data.fileId),
    );
  }
}

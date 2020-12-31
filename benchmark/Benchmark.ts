import {BenchmarkResult} from './BenchmarkRunner';
import {ContentWrapper} from '../src/common/entities/ConentWrapper';
import {Express} from 'express';
import {Utils} from '../src/common/Utils';
import {Message} from '../src/common/entities/Message';

export interface BenchmarkStep {
  name: string;
  fn: ((input?: any) => Promise<ContentWrapper | any[] | void>);
}

/**
 * This class converts PiGallery2 Routers to benchamrkable steps to the Benchmark class
 */
class BMExpressApp {
  readonly benchmark: Benchmark;


  constructor(benchmark: Benchmark) {
    this.benchmark = benchmark;
  }

  get(match: string | string[], ...functions: ((req: any, res: any, next: Function) => void)[]) {
    functions.forEach(f => {
      this.benchmark.addAStep({
        name: this.camelToSpaceSeparated(f.name),
        fn: (request: any) => this.nextToPromise(f, request)
      });
    });
  }

  private camelToSpaceSeparated(text: string) {
    const result = (text.replace(/([A-Z])/g, ' $1')).toLocaleLowerCase();
    return result.charAt(0).toUpperCase() + result.slice(1);
  }

  private nextToPromise(fn: (req: any, res: any, next: Function) => void, request: any) {
    return new Promise<void>((resolve, reject) => {
      const response = {
        header: () => {
        },
        json: (data: any) => {
          resolve(data);
        }
      };
      fn(request, response, (err?: any) => {
        if (err) {
          return reject(err);
        }
        resolve(request.resultPipe);
      });
    });
  }
}

export class Benchmark {


  steps: BenchmarkStep[] = [];
  name: string;
  request: any;
  beforeEach: () => Promise<any>;
  afterEach: () => Promise<any>;
  private readonly bmExpressApp: BMExpressApp;


  constructor(name: string,
              request: any = {},
              beforeEach?: () => Promise<any>,
              afterEach?: () => Promise<any>) {
    this.name = name;
    this.request = request;
    this.beforeEach = beforeEach;
    this.afterEach = afterEach;
    this.bmExpressApp = new BMExpressApp(this);
  }

  get BmExpressApp(): Express {
    return (<unknown>this.bmExpressApp) as Express;
  }

  async run(RUNS: number): Promise<BenchmarkResult> {
    console.log('Running benchmark: ' + this.name);
    const scanned = await this.scanSteps();
    const start = process.hrtime();
    let skip = 0;
    const stepTimer = new Array(this.steps.length).fill(0);
    for (let i = 0; i < RUNS; i++) {
      if (this.beforeEach) {
        const startSkip = process.hrtime();
        await this.beforeEach();
        const endSkip = process.hrtime(startSkip);
        skip += (endSkip[0] * 1000 + endSkip[1] / 1000000);
      }
      await this.runOneRound(stepTimer);
      if (this.afterEach) {
        const startSkip = process.hrtime();
        await this.afterEach();
        const endSkip = process.hrtime(startSkip);
        skip += (endSkip[0] * 1000 + endSkip[1] / 1000000);
      }
    }
    const end = process.hrtime(start);
    const duration = (end[0] * 1000 + end[1] / 1000000 - skip) / RUNS;


    const ret = this.outputToBMResult(this.name, scanned[scanned.length - 1]);
    ret.duration = duration;
    ret.subBenchmarks = scanned.map((o, i) => {
        const stepBm = this.outputToBMResult(this.steps[i].name, o);
        stepBm.duration = stepTimer[i] / RUNS;
        return stepBm;
      }
    );

    return ret;
  }

  outputToBMResult(name: string, output: any[] | ContentWrapper | Message<ContentWrapper>): BenchmarkResult {
    if (output) {
      if (Array.isArray(output)) {
        return {
          name: name,
          duration: null,
          items: output.length,
        };
      }

      if (output instanceof ContentWrapper) {
        return {
          name: name,
          duration: null,
          contentWrapper: output
        };
      }
      if (output instanceof Message) {
        const msg = output.result;
        if (Array.isArray(msg)) {
          return {
            name: name,
            duration: null,
            items: msg.length,
          };
        }

        if (msg instanceof ContentWrapper) {
          return {
            name: name,
            duration: null,
            contentWrapper: msg
          };
        }
      }

    }
    return {
      name: name,
      duration: null
    };
  }

  async scanSteps(): Promise<any[]> {
    const request = Utils.clone(this.request);
    const stepOutput = new Array(this.steps.length);

    for (let j = 0; j < this.steps.length; ++j) {
      if (this.beforeEach) {
        await this.beforeEach();
      }
      for (let i = 0; i <= j; ++i) {
        stepOutput[j] = await this.steps[i].fn(request);
      }
      if (this.afterEach) {
        await this.afterEach();
      }
    }
    return stepOutput;
  }

  async runOneRound(stepTimer: number[]): Promise<number[]> {
    const request = Utils.clone(this.request);
    for (let i = 0; i < this.steps.length; ++i) {
      const start = process.hrtime();
      await this.steps[i].fn(request);
      const end = process.hrtime(start);
      stepTimer[i] += (end[0] * 1000 + end[1] / 1000000);
    }
    return stepTimer;
  }

  addAStep(step: BenchmarkStep) {
    this.steps.push(step);
  }

}

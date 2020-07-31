const serviceUUID = "30c4d481-ea34-457b-8d54-5efc625241f7";
const writeUUID = "e9062e71-9e62-4bc6-b0d3-35cdcd9b027b";
const recordStausUUID = "30c4d483-ea34-457b-8d54-5efc625241f7";
const recordNotifyUUID = "30c4d484-ea34-457b-8d54-5efc625241f7";

const deviceInfoUUID = 0x180a;
const firmwareRevUUID = 0x2a26;

function buf2hex(buffer) {
  // buffer is an ArrayBuffer
  return Array.prototype.map
    .call(new Uint8Array(buffer), (x) => ("00" + x.toString(16)).slice(-2))
    .join("");
}

function zeroPadding(NUM, LEN) {
  return (Array(LEN).join("0") + NUM).slice(-LEN);
}

function formatDate(date, format) {
  format = format.replace(/YYYY/, date.getFullYear());
  format = format.replace(/MM/, zeroPadding(date.getMonth() + 1, 2));
  format = format.replace(/DD/, zeroPadding(date.getDate(), 2));
  format = format.replace(/HH/, zeroPadding(date.getHours(), 2));
  format = format.replace(/MM/, zeroPadding(date.getMinutes(), 2));
  format = format.replace(/SS/, zeroPadding(date.getSeconds(), 2));
  return format;
}

class HrmRecorder {
  constructor() {
    this.errCount = 0;
    this.device = null;
    this.server = null;
    this.firmwareRevString = "unknown";
    this.service = null;
    this.write = null;
    this.recordStatus = null;
    this.recordNotify = null;
  }

  async getDevice() {
    return await navigator.bluetooth.requestDevice({
      filters: [{ services: [serviceUUID] }],
      optionalServices: [deviceInfoUUID],
    });
  }

  async connect(device = null) {
    console.log(device);
    if (this.device != null) {
      await this.device.gatt.disconnect();
    }
    if (device != null) {
      this.device = device;
    }
    if (this.device == null) {
      throw Error("no device");
    }
    console.log(this.device.id);
    this.device.addEventListener("gattserverdisconnected", (event) => {
      if (this.errCount > 3) {
        return;
      }
      this.errCount++;
      setTimeout(() => {
        if (this.device != null) {
          console.log("reconnect...");
          this.connect(this.device);
        }
      }, 1000 * this.errCount);
    });
    this.server = await this.device.gatt.connect();
    this.service = await this.server.getPrimaryService(serviceUUID);
    try {
      let deviceinfo = await this.server.getPrimaryService(
        "device_information"
      );
      let firmwareRev = await deviceinfo.getCharacteristic(firmwareRevUUID);
      this.firmwareRevString = new TextDecoder().decode(
        (await firmwareRev.readValue()).buffer
      );
    } catch (x) {
      console.log("catch:", x);
    }
    this.write = await this.service.getCharacteristic(writeUUID);
    this.recordStatus = await this.service.getCharacteristic(recordStausUUID);
    this.recordNotify = await this.service.getCharacteristic(recordNotifyUUID);
    this.recordNotify.addEventListener(
      "characteristicvaluechanged",
      async (event) => {
        const value = event.target.value.buffer;
        await this.postRecord(value);
      }
    );
    try {
      var posix = Math.floor(new Date().getTime() / 1000);
      var b = new Uint8Array([0xfb, 0, 0, 0, 0]);
      var dv = new DataView(b.buffer);
      dv.setUint32(1, posix, true); // set littleEndian
      await this.write.writeValue(b);
    } catch (x) {
      console.log("catch:", x);
    }
    await this.recordNotify.startNotifications();
    if (this.server.connected) {
      this.errCount = 0;
    }
  }

  async disconnect() {
    if (this.device) {
      var device = this.device;
      this.device = null;
      await device.gatt.disconnect();
    }
  }

  async writeValue(b) {
    if (this.server.connected) {
      await this.write.writeValue(b);
    }
  }

  async readRecordStatus() {
    var b = (await this.recordStatus.readValue()).buffer;
    var dv = new DataView(b);
    this.MinID = dv.getUint32(0, true);
    this.MaxID = dv.getUint32(4, true);
  }

  async reqRecord(id, len) {
    var b = new Uint8Array([0x10, 0, 0, 0, 0, 0, 0]);
    var dv = new DataView(b.buffer);
    dv.setUint32(1, id, true); // set littleEndian
    dv.setUint16(5, len, true); // set littleEndian
    await this.writeValue(b);
  }

  async postRecord(s) {
    var b = new Uint8Array(s);
    var dv = new DataView(b.buffer);
    var id = dv.getUint32(0, true);
    var typ = dv.getUint8(4);
    var len = dv.getUint8(5);
    var msg = [];
    switch (typ) {
      case 0x01:
        var ts = dv.getUint32(6, true);
        var rri = [];
        for (var i = 0; i < 8; i++) {
          rri.push(dv.getUint16(10 + i * 2, true));
        }
        var led = dv.getUint8(26);
        var seq = dv.getUint8(27);
        msg = ["RRI:", id, ts];
        msg.push(...rri);
        msg.push(led, seq);
        break;
      case 0x02:
        var ts = dv.getUint32(6, true);
        var hm = dv.getUint16(10, true) / 100.0;
        var tp = dv.getUint16(12, true) / 100.0;
        var st = dv.getUint16(14, true) / 100.0;
        var et = dv.getUint16(16, true) / 100.0;
        var bat = dv.getUint8(18);
        var flags = dv.getUint8(19);
        msg = ["ENV:", id, ts, hm, tp, st, et, bat, flags];
        break;
    }
    var data = msg.join(", ");
    var l = document.getElementById("log");
    l.value += data + "\n";
    console.log(data);
  }
}

window.HrmRecorder = HrmRecorder;

/**
 * 协议代码生成 - Handlebars 模板字符串
 *
 * 模板渲染前，已在 TypeScript 侧把每个消息的字段类型映射、
 * encode/decode 方法体行预计算好，模板只负责拼接。
 */
import Handlebars from "handlebars";

/** 转义 HTML，避免 < > 被吞 */
Handlebars.registerHelper("raw", function (this: unknown, options: Handlebars.HelperOptions) {
  return options.fn(this);
});

/** 首字母大写，用于生成 setXxx / hasXxx 方法名 */
Handlebars.registerHelper("capitalize", function (str: string) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
});

// 注意：模板中所有缩进为最终输出缩进，预计算行已包含各自缩进。

/**
 * 1. C# MessageBeans.cs（单文件汇总）
 *    - Namespace: GameCore.Message
 *    - 每个 Message 一个类，继承 IMessageRaw
 */
export const MESSAGE_BEANS_CS = `using System;
using System.Collections.Generic;
using GameLogic;
using GameCore.ProtoCollections;

namespace GameCore.Message
{
{{#each structs}}
	/** {{fileName}} */
	/** {{desc}} */
	public class {{name}} : IMessageRaw {
{{#each fields}}
		//{{desc}}
		private {{csType}} _{{csName}};
		public {{csType}} {{csName}} {
			get { return this._{{csName}}; }
			set {
				this._{{csName}} = value;
				this.__setFields.Add("{{csName}}");
			}
		}
		public bool Has{{capitalize csName}} {
			get { return this.__setFields.Contains("{{csName}}"); }
		}
{{/each}}

		public override void encode(ByteBuffer buf) {
{{#each csEncodeLines}}{{this}}
{{/each}}		}

		public override void decode(ByteBuffer buf) {
{{#each csDecodeLines}}{{this}}
{{/each}}		}
	}
{{/each}}
{{#each messages}}
	/** {{fileName}} */
	/** {{desc}} */
	public class {{name}} : IMessageRaw {
{{#each fields}}
		//{{desc}}
		private {{csType}} _{{csName}};
		public {{csType}} {{csName}} {
			get { return this._{{csName}}; }
			set {
				this._{{csName}} = value;
				this.__setFields.Add("{{csName}}");
			}
		}
		public bool Has{{capitalize csName}} {
			get { return this.__setFields.Contains("{{csName}}"); }
		}
{{/each}}

		public override void encode(ByteBuffer buf) {
{{#each csEncodeLines}}{{this}}
{{/each}}		}

		public override void decode(ByteBuffer buf) {
{{#each csDecodeLines}}{{this}}
{{/each}}		}
	}
{{/each}}
}
`;

/**
 * 2. C# MessagePool.cs（单文件汇总）
 *    - 注册所有消息 ID 与类型，S2C 在前，C2S 在后
 */
export const MESSAGE_POOL_CS = `using Com.Rilon.Gamebase.Message;
using GameCore.Message;
using System;

/**
 * @author {{author}}
 *
 * @version 1.0.0
 *
* 引用类列表
*/
namespace Com.Rilon.Gamebase.Message

{
    public class MessagePool
    {

        public string MSG_VER_STR = "{{versionStr}}";
        public int MSG_VER_NUM = {{versionNum}};


        public MessagePool()
        {
            //s2c
{{#each s2cMessages}}            register({{id}}, typeof({{name}}), "{{name}}");
{{/each}}            //=======================================================
            //c2s
{{#each c2sMessages}}            register({{id}}, typeof({{name}}), "{{name}}");
{{/each}}        }

        //注册消息
        private void register(int protocal, System.Type messageType, string msgName)
        {
            MessageDictionary.Add(protocal, msgName, messageType);
        }
		//反序列化消息
        public static IMessageRaw DeSerializeMessage(int pro, System.IO.MemoryStream m)
        {
            return GetMessageByNew(pro, m);
        }

        static IMessageRaw GetMessage(int id)
        {
            var messageType = MessageDictionary.GetMessageType(id);
            if (messageType == null)
            {
                return null;
            }

            return Activator.CreateInstance(messageType) as IMessageRaw;
        }
		 //反序列化消息
        public static IMessageRaw GetMessageByNew(int pro, System.IO.MemoryStream m = null)
        {
            IMessageRaw message = GetMessage(pro);
            if (m != null && message != null)
            {
                //使用proto
                message.MergeFrom(m);
            }
            return message;
        }
    }
}
`;

/**
 * 3. Java 对象类 XXX.java（按模块分包，每对象一个文件）
 */
export const JAVA_STRUCT = `package {{javaPackage}};
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import java.util.ArrayList;
import java.util.List;
import com.rilon.core.session.message.Bean;
{{#each structImports}}import {{this}};
{{/each}}
import lombok.Getter;

/**
 * {{fileName}}
 * @author : {{author}}
 * @since : {{desc}}
 */
@Getter
public class {{javaClassName}} extends Bean {

{{#each fields}}
  // {{desc}}
  private {{javaType}} {{javaName}};
{{/each}}

{{#each fields}}
  public void set{{capitalize javaName}}({{javaType}} {{javaName}}) {
    this.{{javaName}} = {{javaName}};
    this.__setFields.add("{{javaName}}");
  }

  public boolean has{{capitalize javaName}}() {
    return this.__setFields.contains("{{javaName}}");
  }

{{/each}}
  @Override
  public boolean write(ByteBuf buf) {
{{#each javaWriteLines}}{{this}}
{{/each}}    return true;
  }

  @Override
  public boolean read(ByteBuf buf) {
{{#each javaReadLines}}{{this}}
{{/each}}    return true;
  }

}
`;

/**
 * 4. Java 实体类 XXXMessage.java（按模块分包，每消息一个文件）
 */
export const JAVA_MESSAGE = `package {{javaPackage}};
import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import java.util.ArrayList;
import java.util.List;
import com.rilon.core.session.message.Message;
{{#each structImports}}import {{this}};
{{/each}}import lombok.Getter;

/**
 * {{fileName}}
 * @author : {{author}}
 * @since : {{desc}}
 */
@Getter
public class {{javaClassName}} extends Message {

{{#each fields}}
  // {{desc}}
  private {{javaType}} {{javaName}};
{{/each}}

{{#each fields}}
  public void set{{capitalize javaName}}({{javaType}} {{javaName}}) {
    this.{{javaName}} = {{javaName}};
    this.__setFields.add("{{javaName}}");
  }

  public boolean has{{capitalize javaName}}() {
    return this.__setFields.contains("{{javaName}}");
  }

{{/each}}
  @Override
  public boolean write(ByteBuf buf) {
{{#each javaWriteLines}}{{this}}
{{/each}}    return true;
  }

  @Override
  public boolean read(ByteBuf buf) {
{{#each javaReadLines}}{{this}}
{{/each}}    return true;
  }

}
`;

/**
 * 5. Java MessageId.java（单文件汇总）
 *    - 收集所有消息生成常量
 */
export const MESSAGE_ID_JAVA = `package {{messageIdPackage}};

/**
 * MessageId
 *
 * @author : {{author}}
 * @since : 工具自动生成
 */

public class MessageId {

  public static final String MSG_VER_STR = "{{versionStr}}";

  public static final int MSG_VER_NUM = {{versionNum}};

  //S_2_P================================================
  public static final int MIN_S2P_ID = 1000;

{{#each s2pMessages}}  public static final int {{name}}_AutoId = {{id}};

{{/each}}
  public static final int MAX_S2P_ID = 4999;


  //P_2_S================================================
  public static final int MIN_P2S_ID = 5000;

{{#each p2sMessages}}  public static final int {{name}}_AutoId = {{id}};

{{/each}}
  public static final int MAX_P2S_ID = 9999;


  //C_2_S=======================================================================
  public static final int MIN_C2S_ID = 10000;

{{#each c2sMessages}}  public static final int {{name}}_AutoId = {{id}};

{{/each}}
  public static final int MAX_C2S_ID = 19999;


  //S_2_C=======================================================================
  public static final int MIN_S2C_ID = 20000;

{{#each s2cMessages}}  public static final int {{name}}_AutoId = {{id}};

{{/each}}
  public static final int MAX_S2C_ID = 29999;

}
`;

/**
 * 6. Java GameHandlerManager.java（单文件汇总）
 *    - 仅对 C2S / P2S 消息生成路由注册
 */
export const GAME_HANDLER_MANAGER_JAVA = `package {{gameHandlerManagerPackage}};

import com.rilon.gamebase.log.GameLogger;
import com.rilon.core.session.message.MessagePool;

/**
 * GameHandlerManager.java
 *
 * @author : {{author}}
 * @since : 工具自动生成
 */
public class GameHandlerManager {

  /**
   * 日志
   */
  private static final GameLogger LOGGER = new GameLogger(GameHandlerManager.class);

  ;

  private static volatile GameHandlerManager s_me;

  private GameHandlerManager() {
  }

  /**
   * 单例模式 *
   */
  public static GameHandlerManager getMe() {
    if (s_me == null) {
      synchronized (GameHandlerManager.class) {
        if (s_me == null) {
          s_me = new GameHandlerManager();
        }
      }
    }
    return s_me;
  }

  public void initHandlers(MessagePool gameHandlerManager) {
{{#each c2sMessages}}    gameHandlerManager.register({{id}}, {{javaPackage}}.{{javaClassName}}.class, {{handlerPackage}}.{{handlerClassName}}.class);
{{/each}}    gameHandlerManager.useHandlers();
    LOGGER.info("消息注册完毕!");
  }

}
`;

/**
 * 7. Java XXXHandler.java（仅 C2S / P2S，骨架文件）
 */
export const JAVA_HANDLER = `package {{handlerPackage}};

import com.rilon.gamebase.log.GameLogger;
import com.rilon.core.command.MessageHandler;
import {{javaPackage}}.{{javaClassName}};

/**
 * @author : {{author}}
 * @since : 自动生成
 */
public class {{handlerClassName}} extends MessageHandler<{{javaClassName}}> {

    /**
     * 日志
     */
    private static final GameLogger LOGGER = new GameLogger({{handlerClassName}}.class);

    @Override
    public void action() {
        try {
            {{javaClassName}} msg = this.getMessage();
            // TODO: 处理 {{javaClassName}} 业务逻辑

        } catch (Exception e) {
            LOGGER.error(e, e);
        }
    }
}
`;

// 代码生成场景不需要 HTML 转义，统一关闭
const COMPILE_OPTS = { noEscape: true };

/** 编译后的模板 */
export const templates = {
  messageBeansCs: Handlebars.compile(MESSAGE_BEANS_CS, COMPILE_OPTS),
  javaStruct: Handlebars.compile(JAVA_STRUCT, COMPILE_OPTS),
  messagePoolCs: Handlebars.compile(MESSAGE_POOL_CS, COMPILE_OPTS),
  javaMessage: Handlebars.compile(JAVA_MESSAGE, COMPILE_OPTS),
  messageIdJava: Handlebars.compile(MESSAGE_ID_JAVA, COMPILE_OPTS),
  gameHandlerManagerJava: Handlebars.compile(GAME_HANDLER_MANAGER_JAVA, COMPILE_OPTS),
  javaHandler: Handlebars.compile(JAVA_HANDLER, COMPILE_OPTS),
};
